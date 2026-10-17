// All district road data, merged into the graph by roads.ts. Order matters only for ids referenced
// across districts: motorway first (others may connect to its nodes), bridges last.
import { motorway } from "./motorway";
import { containerTerminal } from "./containerTerminal";
import { industrial } from "./industrial";
import { southbank } from "./southbank";
import { oldTown } from "./oldTown";
import { shoreditch } from "./shoreditch";
import { hampstead } from "./hampstead";
import { government } from "./government";
import { bridges } from "./bridges";

export const DISTRICTS = { motorway, containerTerminal, industrial, southbank, oldTown, shoreditch, hampstead, government, bridges };
