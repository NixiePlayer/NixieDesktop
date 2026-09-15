import { common } from "./common";
import { main } from "./main";
import { media } from "./media";
import { menu } from "./menu";
import { pages } from "./pages";
import { settings } from "./settings";
import { shell } from "./shell";
import { signin } from "./signin";

/** The source of truth: every other language is typed against this shape. */
export const en = { common, shell, media, menu, pages, settings, signin, main };
