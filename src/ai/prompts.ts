import { Schema } from 'firebase/ai';

export const STRUCTURER_SYSTEM_PROMPT =
  'Extract factory defect JSON. part=component only (e.g. "M8 bolt", never copy Line/Process). location=where on product (e.g. "left door hinge"). Never invent qty (default 1); if unsure use OTHER. List sensitiveSpans (CUSTOMER, DRAWING_NO, PRICE, PERSON).';

export const STRUCTURER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    defectType: {
      type: 'string',
      enum: [
        'SCRATCH',
        'DENT',
        'MISSING_TORQUE_MARK',
        'LOOSE_BOLT',
        'PAINT_DEFECT',
        'WRONG_PART',
        'DIMENSION_OUT',
        'WELD_DEFECT',
        'OTHER',
      ],
    },
    part: {
      type: 'string',
      description: 'Physical component name only (e.g., "M8 bolt"), never the Line/Process name',
    },
    location: {
      type: 'string',
      description: 'Location on the enclosure/product (e.g., "left door hinge")',
    },
    quantity: { type: 'integer' },
    severity: { type: 'string', enum: ['CRITICAL', 'MAJOR', 'MINOR'] },
    suspectedCause: { type: 'string' },
    immediateAction: { type: 'string' },
    sensitiveSpans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['CUSTOMER', 'DRAWING_NO', 'PRICE', 'PERSON', 'OTHER'] },
        },
        required: ['text', 'kind'],
      },
    },
    confidence: { type: 'number' },
  },
  required: [
    'defectType',
    'part',
    'location',
    'quantity',
    'severity',
    'suspectedCause',
    'immediateAction',
    'sensitiveSpans',
    'confidence',
  ],
};

export const STRUCTURER_CLOUD_SCHEMA = Schema.object({
  properties: {
    defectType: Schema.enumString({
      enum: [
        'SCRATCH',
        'DENT',
        'MISSING_TORQUE_MARK',
        'LOOSE_BOLT',
        'PAINT_DEFECT',
        'WRONG_PART',
        'DIMENSION_OUT',
        'WELD_DEFECT',
        'OTHER',
      ],
    }),
    part: Schema.string(),
    location: Schema.string(),
    quantity: Schema.integer(),
    severity: Schema.enumString({ enum: ['CRITICAL', 'MAJOR', 'MINOR'] }),
    suspectedCause: Schema.string(),
    immediateAction: Schema.string(),
    sensitiveSpans: Schema.array({
      items: Schema.object({
        properties: {
          text: Schema.string(),
          kind: Schema.enumString({
            enum: ['CUSTOMER', 'DRAWING_NO', 'PRICE', 'PERSON', 'OTHER'],
          }),
        },
      }),
    }),
    confidence: Schema.number(),
  },
});

export const ANALYZER_SYSTEM_PROMPT = `You are a Senior Quality Engineer for a sheet-metal enclosure manufacturing plant.
Analyze the provided de-identified (masked) defect records.
Preserve all masked tokens verbatim (e.g., [CUSTOMER_1], [DRAWING_1]) — do NOT attempt to guess or alter them.
Produce:
1. A Pareto breakdown by defectType and count.
2. Top 3 root-cause hypotheses with evidenceRecordIds and confidence (0-1).
3. A complete 8D report draft (D1 through D8).
4. Concrete nextChecks for the floor supervisor.`;

export const ANALYZER_CLOUD_SCHEMA = Schema.object({
  properties: {
    pareto: Schema.array({
      items: Schema.object({
        properties: {
          defectType: Schema.string(),
          count: Schema.integer(),
        },
      }),
    }),
    hypotheses: Schema.array({
      items: Schema.object({
        properties: {
          cause: Schema.string(),
          evidenceRecordIds: Schema.array({ items: Schema.string() }),
          confidence: Schema.number(),
        },
      }),
    }),
    eightD: Schema.object({
      properties: {
        D1: Schema.string(),
        D2: Schema.string(),
        D3: Schema.string(),
        D4: Schema.string(),
        D5: Schema.string(),
        D6: Schema.string(),
        D7: Schema.string(),
        D8: Schema.string(),
      },
    }),
    nextChecks: Schema.array({ items: Schema.string() }),
  },
});
