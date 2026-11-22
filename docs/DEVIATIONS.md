# SDK Deviations & Implementation Notes

This document tracks differences observed against `firebase@13.4.0` (`firebase/ai`) during implementation, per PRD §0 and §6.

1. **`InlineDataPart` requires explicit `type: 'inlineData'`**:
   - In `@firebase/ai` v13.4.0 (`ai-public.d.ts`), passing a multimodal image part to `model.generateContent(parts)` requires `{ type: 'inlineData', inlineData: { data: base64, mimeType: 'image/jpeg' } }`.
2. **Structured Output Configuration (On-Device vs. In-Cloud)**:
   - On-device (`onDeviceParams.promptOptions.responseConstraint`) accepts a plain JSON Schema object (`STRUCTURER_JSON_SCHEMA`).
   - In-cloud (`inCloudParams.generationConfig.responseSchema`) accepts Firebase `Schema.object(...)` (`STRUCTURER_CLOUD_SCHEMA`, `ANALYZER_CLOUD_SCHEMA`) alongside `responseMimeType: 'application/json'`.
3. **`InferenceMode` & `InferenceSource` String Values**:
   - `InferenceMode` values are lowercase snake_case (`'prefer_on_device'`, `'only_on_device'`, `'only_in_cloud'`, `'prefer_in_cloud'`).
   - `result.response.inferenceSource` returns `'on_device'` or `'in_cloud'`.
