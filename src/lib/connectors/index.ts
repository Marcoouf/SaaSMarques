export type RawHit = {
  markText: string;
  classes: number[];
  statusLabel?: string;
  applicationNo?: string;
  holder?: string;
  source: "INPI" | "EUIPO";
};

export type SearchConnector = (args: {
  query: string;
  classes: number[];
}) => Promise<RawHit[]>;

export { searchINPI } from "./inpi";
export { searchEUIPO } from "./euipo";