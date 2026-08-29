import { ModelRow } from "./types";

/** Strips the API key from a model row, leaving only a masked preview. */
export function maskModel(m: ModelRow) {
  const { api_key, ...rest } = m;
  return {
    ...rest,
    has_api_key: Boolean(api_key),
    api_key_preview: api_key ? `${api_key.slice(0, 4)}…${api_key.slice(-4)}` : null,
  };
}

export type MaskedModel = ReturnType<typeof maskModel>;
