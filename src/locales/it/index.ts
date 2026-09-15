import type { Messages } from "../../shared/i18n";
import { common } from "./common";
import { main } from "./main";
import { media } from "./media";
import { menu } from "./menu";
import { pages } from "./pages";
import { settings } from "./settings";
import { shell } from "./shell";
import { signin } from "./signin";

export const it: Messages = { common, shell, media, menu, pages, settings, signin, main };
