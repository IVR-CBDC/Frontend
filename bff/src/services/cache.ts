import NodeCache from "node-cache";












export const quotesCache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
