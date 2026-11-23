import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InferenceMode } from 'firebase/ai';

const mockGenerateContentStream = vi.fn();
const mockInitializeDeviceModel = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  initializeDeviceModel: mockInitializeDeviceModel,
  generateContentStream: mockGenerateContentStream,
}));
const mockAddHybridLog = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/ai', async () => {
  const actual = await vi.importActual<typeof import('firebase/ai')>('firebase/ai');
  return {
    ...actual,
    getAI: vi.fn(() => ({})),
    getGenerativeModel: (...args: unknown[]) => mockGetGenerativeModel(...(args as [])),
  };
});

vi.mock('../firebase', () => ({
  app: {},
  getRemotePolicy: () => ({
    sensitivePatterns: ['\\b[A-Z]{2}-\\d{3,5}\\b'],
    customerNames: ['ACME-77'],
    structurerMode: 'prefer_on_device',
    cloudModel: 'gemini-3.5-flash-lite',
  }),
}));

vi.mock('../data/db', () => ({
  addHybridLog: (...args: unknown[]) => mockAddHybridLog(...args),
  localDb: { tokenMap: { toArray: vi.fn().mockResolvedValue([]) } },
}));

import { structureDefectNote } from './models';

const VALID_JSON = JSON.stringify({
  defectType: 'MISSING_TORQUE_MARK',
  part: 'M8 bolt',
  location: 'left door hinge',
  quantity: 4,
  severity: 'MAJOR',
  suspectedCause: 'Missed mark',
  immediateAction: 'Re-torque',
  sensitiveSpans: [],
  confidence: 0.9,
});

function makeStreamResponse(text: string, inferenceSource: string) {
  return {
    stream: (async function* () {
      yield { text: () => text };
    })(),
    response: Promise.resolve({
      text: () => text,
      inferenceSource,
    }),
  };
}

describe('structureDefectNote fail-closed & fallback guards', () => {
  const originalLanguageModel = (globalThis as { LanguageModel?: unknown }).LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeDeviceModel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalLanguageModel === undefined) {
      delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    } else {
      (globalThis as { LanguageModel?: unknown }).LanguageModel = originalLanguageModel;
    }
  });

  it('blocks ONLY_ON_DEVICE without calling getGenerativeModel when globalThis.LanguageModel is undefined', async () => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;

    await expect(
      structureDefectNote({
        noteText: 'Bolt mark missing on M8 x4, cust ACME-77',
        line: 'Door Hinge Assembly #3',
        mode: InferenceMode.ONLY_ON_DEVICE,
      })
    ).rejects.toThrow(/BLOCKED: no on-device model/);

    expect(mockGetGenerativeModel).not.toHaveBeenCalled();
    expect(mockGenerateContentStream).not.toHaveBeenCalled();
    expect(mockAddHybridLog).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'structure_note',
        requestedMode: InferenceMode.ONLY_ON_DEVICE,
        actualSource: 'none',
        cloudBytes: 0,
        blocked: true,
        reason: 'no on-device model',
      })
    );
  });

  it('blocks ONLY_ON_DEVICE without calling getGenerativeModel when LanguageModel.availability() !== available', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn().mockResolvedValue('unavailable'),
    };

    await expect(
      structureDefectNote({
        noteText: 'Confidential note',
        line: 'Final QC Station',
        mode: InferenceMode.ONLY_ON_DEVICE,
      })
    ).rejects.toThrow(/BLOCKED: no on-device model/);

    expect(mockGetGenerativeModel).not.toHaveBeenCalled();
    expect(mockGenerateContentStream).not.toHaveBeenCalled();
  });

  it('rejects result and logs unexpected cloud inference if ONLY_ON_DEVICE returns IN_CLOUD', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn().mockResolvedValue('available'),
    };
    mockGenerateContentStream.mockResolvedValueOnce(makeStreamResponse(VALID_JSON, 'IN_CLOUD'));

    await expect(
      structureDefectNote({
        noteText: 'Confidential note',
        line: 'Final QC Station',
        mode: InferenceMode.ONLY_ON_DEVICE,
      })
    ).rejects.toThrow(/BLOCKED: unexpected cloud inference/);

    expect(mockAddHybridLog).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'structure_note',
        requestedMode: InferenceMode.ONLY_ON_DEVICE,
        actualSource: 'none',
        cloudBytes: 0,
        blocked: true,
        reason: 'unexpected cloud inference',
      })
    );
  });

  it('retries once with ONLY_IN_CLOUD when PREFER_ON_DEVICE on-device generation throws', async () => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: vi.fn().mockResolvedValue('available'),
    };
    mockGenerateContentStream
      .mockRejectedValueOnce(new Error('The input is too large'))
      .mockResolvedValueOnce(makeStreamResponse(VALID_JSON, 'in_cloud'));

    const res = await structureDefectNote({
      noteText: 'Orange peel paint defect on front enclosure panel, qty 2',
      line: 'Powder Coating Line A',
      mode: InferenceMode.PREFER_ON_DEVICE,
    });

    expect(res.source).toBe('in_cloud');
    expect(mockGetGenerativeModel).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: InferenceMode.ONLY_IN_CLOUD })
    );
  });
});
