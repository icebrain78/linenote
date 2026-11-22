import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
  type Part,
} from 'firebase/ai';
import { app, getRemotePolicy } from '../firebase';
import { addHybridLog, localDb } from '../data/db';
import type { InferenceSourceType, RootCauseAnalysis, StructuredDefect } from '../types';
import {
  ANALYZER_CLOUD_SCHEMA,
  ANALYZER_SYSTEM_PROMPT,
  STRUCTURER_CLOUD_SCHEMA,
  STRUCTURER_JSON_SCHEMA,
  STRUCTURER_SYSTEM_PROMPT,
} from './prompts';
import { buildGlobalTokenContext } from './masking';
import { guardCloudPayload, sanitizeAndGuardCloudRecord, type CloudSafeRecordFields } from './router';
import { postProcessStructuredDefect } from './postprocess';

export type OnDeviceStatus = 'available' | 'downloading' | 'unavailable' | 'unknown';

type StatusListener = (status: OnDeviceStatus, progress: number) => void;
const statusListeners = new Set<StatusListener>();
let currentOnDeviceStatus: OnDeviceStatus = 'unknown';
let currentDownloadProgress = 0;

export function subscribeOnDeviceStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(currentOnDeviceStatus, currentDownloadProgress);
  return () => statusListeners.delete(listener);
}

function setOnDeviceStatus(status: OnDeviceStatus, progress = 0) {
  currentOnDeviceStatus = status;
  currentDownloadProgress = progress;
  statusListeners.forEach((fn) => fn(status, progress));
}

export async function checkChromeLanguageModelAvailability(): Promise<string> {
  try {
    const win = window as unknown as {
      LanguageModel?: { availability?: () => Promise<string> };
      ai?: { languageModel?: { capabilities?: () => Promise<{ available: string }> } };
    };
    if (win.LanguageModel?.availability) {
      const res = await win.LanguageModel.availability();
      if (res === 'available' || res === 'readily') {
        setOnDeviceStatus('available', 100);
      } else if (res === 'downloading' || res === 'downloadable' || res === 'after-download') {
        setOnDeviceStatus('downloading', 0);
      } else {
        setOnDeviceStatus('unavailable', 0);
      }
      return res;
    }
    if (win.ai?.languageModel?.capabilities) {
      const cap = await win.ai.languageModel.capabilities();
      setOnDeviceStatus(cap.available === 'readily' ? 'available' : 'unavailable', 0);
      return cap.available;
    }
    setOnDeviceStatus('unavailable', 0);
    return 'unsupported (LanguageModel API not found)';
  } catch (err) {
    setOnDeviceStatus('unavailable', 0);
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Singleton caches for AI instance, GenerativeModel instances, and one-time device init
let aiInstance: ReturnType<typeof getAI> | null = null;
const modelCache = new Map<string, GenerativeModel>();
const initPromiseCache = new Map<string, Promise<void>>();

function getAIInstance() {
  if (!app) {
    throw new Error('Firebase app is not initialized. Check .env.local configuration.');
  }
  if (!aiInstance) {
    aiInstance = getAI(app, { backend: new GoogleAIBackend() });
  }
  return aiInstance;
}

function ensureInitializedOnce(key: string, model: GenerativeModel): Promise<void> {
  let promise = initPromiseCache.get(key);
  if (!promise) {
    promise = (async () => {
      await model.initializeDeviceModel((progress) => {
        const pct = Math.round(progress * 100);
        setOnDeviceStatus(pct < 100 ? 'downloading' : 'available', pct);
      });
      await checkChromeLanguageModelAvailability();
    })().catch((err) => {
      initPromiseCache.delete(key);
      throw err;
    });
    initPromiseCache.set(key, promise);
  }
  return promise;
}

export function getStructurerModel(mode: InferenceMode, withImage: boolean): GenerativeModel {
  const policy = getRemotePolicy();
  const cloudModel = policy.cloudModel || 'gemini-3.5-flash-lite';
  const cacheKey = `structurer:${mode}:${withImage ? 'img' : 'txt'}:${cloudModel}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const ai = getAIInstance();
  const model = getGenerativeModel(ai, {
    mode,
    onDeviceParams: {
      createOptions: {
        expectedInputs: withImage
          ? [{ type: 'text', languages: ['en'] }, { type: 'image' }]
          : [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          {
            role: 'system',
            content: [{ type: 'text', value: STRUCTURER_SYSTEM_PROMPT }],
          },
        ],
      },
      promptOptions: {
        responseConstraint: STRUCTURER_JSON_SCHEMA,
      },
    },
    inCloudParams: {
      model: cloudModel,
      systemInstruction: STRUCTURER_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: STRUCTURER_CLOUD_SCHEMA,
        maxOutputTokens: 256,
      },
    },
  });

  modelCache.set(cacheKey, model);
  return model;
}

export function getAnalyzerModel(): GenerativeModel {
  const policy = getRemotePolicy();
  const cloudModel = policy.cloudModel || 'gemini-3.5-flash-lite';
  const cacheKey = `analyzer:${cloudModel}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const ai = getAIInstance();
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: cloudModel,
      systemInstruction: ANALYZER_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ANALYZER_CLOUD_SCHEMA,
      },
    },
  });

  modelCache.set(cacheKey, model);
  return model;
}

export function getTranslatorModel(): GenerativeModel {
  const policy = getRemotePolicy();
  const cloudModel = policy.cloudModel || 'gemini-3.5-flash-lite';
  const cacheKey = `translator:${cloudModel}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const ai = getAIInstance();
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                value: 'Translate KO<->EN concisely. Keep part codes.',
              },
            ],
          },
        ],
      },
    },
    inCloudParams: {
      model: cloudModel,
      systemInstruction: 'Translate KO<->EN concisely. Keep part codes.',
      generationConfig: { maxOutputTokens: 128 },
    },
  });

  modelCache.set(cacheKey, model);
  return model;
}

export function getHelloModel(): GenerativeModel {
  const policy = getRemotePolicy();
  const cloudModel = policy.cloudModel || 'gemini-3.5-flash-lite';
  const cacheKey = `hello:${cloudModel}`;

  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const ai = getAIInstance();
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      },
    },
    inCloudParams: {
      model: cloudModel,
      generationConfig: { maxOutputTokens: 64 },
    },
  });

  modelCache.set(cacheKey, model);
  return model;
}

function parseJsonWithFallback(rawText: string): StructuredDefect {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  return {
    defectType: parsed.defectType || 'OTHER',
    part: parsed.part || 'Unknown part',
    location: parsed.location || 'Unspecified',
    quantity: Number.isFinite(Number(parsed.quantity)) ? Math.max(1, Math.round(Number(parsed.quantity))) : 1,
    severity: parsed.severity || 'MINOR',
    suspectedCause: parsed.suspectedCause || '',
    immediateAction: parsed.immediateAction || '',
    sensitiveSpans: Array.isArray(parsed.sensitiveSpans) ? parsed.sensitiveSpans : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };
}

class ChromiumEchoStubError extends Error {
  constructor() {
    super(
      'This browser has Chromium Prompt API echo stub instead of Gemini Nano weights. Confidential notes are saved locally without AI; non-confidential notes use Cloud.'
    );
    this.name = 'ChromiumEchoStubError';
  }
}

function isChromiumEchoStub(text: string): boolean {
  return text.trim().startsWith('On-device model is not available in Chromium');
}

async function runStreamed(
  model: GenerativeModel,
  parts: string | Array<string | Part>,
  t0: number,
  onToken?: (accumulatedText: string, ttftMs?: number) => void
): Promise<{ text: string; source: InferenceSourceType; ttftMs: number; latencyMs: number }> {
  const streamResult = await model.generateContentStream(parts);
  let accumulated = '';
  let ttftMs: number | undefined;

  for await (const chunk of streamResult.stream) {
    const chunkText = chunk.text();
    if (chunkText) {
      if (ttftMs === undefined) {
        ttftMs = Math.round(performance.now() - t0);
      }
      accumulated += chunkText;
      if (!isChromiumEchoStub(accumulated)) {
        onToken?.(accumulated, ttftMs);
      }
    }
  }

  const finalRes = await streamResult.response;
  const latencyMs = Math.round(performance.now() - t0);
  const finalText = finalRes.text() || accumulated;
  const source = (finalRes.inferenceSource as InferenceSourceType) || 'none';

  if (isChromiumEchoStub(finalText)) {
    setOnDeviceStatus('unavailable', 0);
    throw new ChromiumEchoStubError();
  }

  return {
    text: finalText,
    source,
    ttftMs: ttftMs ?? latencyMs,
    latencyMs,
  };
}

export interface StructureResult {
  structured: StructuredDefect;
  source: InferenceSourceType;
  ttftMs: number;
  latencyMs: number;
  quantityCorrected: boolean;
  originalQuantity: number;
}

export async function structureDefectNote(params: {
  noteText: string;
  line: string;
  imageDataUrl?: string;
  mode: InferenceMode;
  onToken?: (partialText: string, ttftMs?: number) => void;
}): Promise<StructureResult> {
  const { noteText, line, imageDataUrl, mode, onToken } = params;
  const hasImage = Boolean(imageDataUrl);
  const model = getStructurerModel(mode, hasImage);
  const initKey = `structurer:${mode}:${hasImage ? 'img' : 'txt'}`;

  const t0 = performance.now();

  try {
    await ensureInitializedOnce(initKey, model);
  } catch (initErr) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      const ms = Math.round(performance.now() - t0);
      await addHybridLog({
        task: 'structure_note',
        requestedMode: mode,
        actualSource: 'none',
        ttftMs: ms,
        latencyMs: ms,
        cloudBytes: 0,
        blocked: true,
        reason: 'On-device model unavailable for ONLY_ON_DEVICE request',
      });
      throw new Error(
        'This note contains confidential data and no on-device model is available. Saved locally without AI.'
      );
    }
    console.warn('On-device model init skipped/failed, falling back if allowed:', initErr);
  }

  const promptText = `Line: ${line}\nNote: ${noteText}`;
  const parts: Array<string | Part> = [promptText];

  if (imageDataUrl && imageDataUrl.includes(',')) {
    const base64 = imageDataUrl.split(',')[1];
    parts.push({
      type: 'inlineData',
      inlineData: {
        data: base64,
        mimeType: 'image/jpeg',
      },
    });
  }

  let streamOut: { text: string; source: InferenceSourceType; ttftMs: number; latencyMs: number };

  try {
    streamOut = await runStreamed(model, parts, t0, onToken);
  } catch (err) {
    if (err instanceof ChromiumEchoStubError) {
      if (mode === InferenceMode.PREFER_ON_DEVICE) {
        const cloudModel = getStructurerModel(InferenceMode.ONLY_IN_CLOUD, hasImage);
        streamOut = await runStreamed(cloudModel, parts, t0, onToken);
      } else {
        const ms = Math.round(performance.now() - t0);
        await addHybridLog({
          task: 'structure_note',
          requestedMode: mode,
          actualSource: 'none',
          ttftMs: ms,
          latencyMs: ms,
          cloudBytes: 0,
          blocked: true,
          reason: err.message,
        });
        throw new Error(
          'This note contains confidential data and no on-device model is available. Saved locally without AI.'
        );
      }
    } else if (hasImage) {
      const textModel = getStructurerModel(mode, false);
      streamOut = await runStreamed(textModel, promptText, t0, onToken);
    } else {
      const ms = Math.round(performance.now() - t0);
      await addHybridLog({
        task: 'structure_note',
        requestedMode: mode,
        actualSource: 'none',
        ttftMs: ms,
        latencyMs: ms,
        cloudBytes: 0,
        blocked: mode === InferenceMode.ONLY_ON_DEVICE,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  const cloudBytes = streamOut.source === 'in_cloud' ? new Blob([promptText]).size : 0;

  await addHybridLog({
    task: 'structure_note',
    requestedMode: mode,
    actualSource: streamOut.source,
    ttftMs: streamOut.ttftMs,
    latencyMs: streamOut.latencyMs,
    cloudBytes,
    blocked: false,
  });

  try {
    const rawParsed = parseJsonWithFallback(streamOut.text);
    const post = postProcessStructuredDefect(noteText, rawParsed);
    return {
      structured: post.structured,
      source: streamOut.source,
      ttftMs: streamOut.ttftMs,
      latencyMs: streamOut.latencyMs,
      quantityCorrected: post.quantityCorrected,
      originalQuantity: post.originalQuantity,
    };
  } catch {
    const retry = await runStreamed(model, `${promptText}\nReturn valid JSON only.`, t0, onToken);
    const rawParsed = parseJsonWithFallback(retry.text);
    const post = postProcessStructuredDefect(noteText, rawParsed);
    return {
      structured: post.structured,
      source: retry.source,
      ttftMs: streamOut.ttftMs,
      latencyMs: retry.latencyMs,
      quantityCorrected: post.quantityCorrected,
      originalQuantity: post.originalQuantity,
    };
  }
}

export async function analyzeMaskedRecordsInCloud(
  maskedRecordsPayload: CloudSafeRecordFields[]
): Promise<Omit<RootCauseAnalysis, 'id' | 'recordIds' | 'createdAt'>> {
  const policy = getRemotePolicy();
  const entries = await localDb.tokenMap.toArray();
  const globalCtx = buildGlobalTokenContext(entries);

  const sanitizedRecords: CloudSafeRecordFields[] = [];
  for (const rec of maskedRecordsPayload) {
    const check = sanitizeAndGuardCloudRecord(rec, policy, globalCtx);
    if (!check.allowed || !check.sanitizedRecord) {
      await addHybridLog({
        task: 'analyze_root_causes',
        requestedMode: InferenceMode.ONLY_IN_CLOUD,
        actualSource: 'none',
        ttftMs: 0,
        latencyMs: 0,
        cloudBytes: 0,
        blocked: true,
        reason: check.blockedReason || 'Blocked by fail-closed field guard.',
      });
      throw new Error(check.blockedReason || 'Blocked by fail-closed sensitivity guard.');
    }
    sanitizedRecords.push(check.sanitizedRecord);
  }

  const serialized = JSON.stringify(sanitizedRecords, null, 2);
  const guard = guardCloudPayload(serialized, policy);
  if (!guard.allowed) {
    await addHybridLog({
      task: 'analyze_root_causes',
      requestedMode: InferenceMode.ONLY_IN_CLOUD,
      actualSource: 'none',
      ttftMs: 0,
      latencyMs: 0,
      cloudBytes: 0,
      blocked: true,
      reason: guard.blockedReason,
    });
    throw new Error(guard.blockedReason || 'Blocked by fail-closed sensitivity guard.');
  }

  const model = getAnalyzerModel();
  const t0 = performance.now();
  const prompt = `Analyze these ${maskedRecordsPayload.length} masked defect records from a sheet-metal enclosure plant:\n\n${serialized}`;

  const result = await model.generateContent(prompt);
  const latencyMs = Math.round(performance.now() - t0);
  const source = (result.response.inferenceSource as InferenceSourceType) || 'none';
  const cloudBytes = new Blob([prompt]).size;

  await addHybridLog({
    task: 'analyze_root_causes',
    requestedMode: InferenceMode.ONLY_IN_CLOUD,
    actualSource: source,
    ttftMs: latencyMs,
    latencyMs,
    cloudBytes,
    blocked: false,
  });

  const parsed = JSON.parse(result.response.text());
  return {
    pareto: parsed.pareto || [],
    hypotheses: parsed.hypotheses || [],
    eightD: parsed.eightD || {
      D1: '',
      D2: '',
      D3: '',
      D4: '',
      D5: '',
      D6: '',
      D7: '',
      D8: '',
    },
    nextChecks: parsed.nextChecks || [],
    sentPayloadJson: serialized,
    inferenceSource: source,
    latencyMs,
  };
}

export async function runDeviceHelloTest(
  onToken?: (partialText: string, ttftMs?: number) => void
): Promise<{
  text: string;
  source: InferenceSourceType;
  ttftMs: number;
  latencyMs: number;
}> {
  const model = getHelloModel();
  const t0 = performance.now();

  try {
    await ensureInitializedOnce('hello', model);
  } catch {
    // Allow cloud fallback in PREFER_ON_DEVICE
  }

  let streamOut: { text: string; source: InferenceSourceType; ttftMs: number; latencyMs: number };
  try {
    streamOut = await runStreamed(
      model,
      'Say "Hello from LineNote Hybrid AI!" in one short sentence.',
      t0,
      onToken
    );
  } catch (err) {
    if (err instanceof ChromiumEchoStubError) {
      const ai = getAIInstance();
      const cloudOnly = getGenerativeModel(ai, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: {
          model: getRemotePolicy().cloudModel || 'gemini-3.5-flash-lite',
          generationConfig: { maxOutputTokens: 64 },
        },
      });
      streamOut = await runStreamed(
        cloudOnly,
        'Say "Hello from LineNote Hybrid AI!" in one short sentence.',
        t0,
        onToken
      );
    } else {
      throw err;
    }
  }

  await addHybridLog({
    task: 'device_check',
    requestedMode: InferenceMode.PREFER_ON_DEVICE,
    actualSource: streamOut.source,
    ttftMs: streamOut.ttftMs,
    latencyMs: streamOut.latencyMs,
    cloudBytes: streamOut.source === 'in_cloud' ? 50 : 0,
    blocked: false,
  });

  return streamOut;
}

export async function translateShortNote(text: string): Promise<{
  translated: string;
  source: InferenceSourceType;
  latencyMs: number;
}> {
  const model = getTranslatorModel();
  const t0 = performance.now();

  try {
    await ensureInitializedOnce('translator', model);
  } catch {
    // Allow cloud fallback
  }

  const streamOut = await runStreamed(model, `Translate KO<->EN:\n${text}`, t0);

  await addHybridLog({
    task: 'translate_note',
    requestedMode: InferenceMode.PREFER_ON_DEVICE,
    actualSource: streamOut.source,
    ttftMs: streamOut.ttftMs,
    latencyMs: streamOut.latencyMs,
    cloudBytes: streamOut.source === 'in_cloud' ? new Blob([text]).size : 0,
    blocked: false,
  });

  return {
    translated: streamOut.text,
    source: streamOut.source,
    latencyMs: streamOut.latencyMs,
  };
}
