import { contextBridge, ipcRenderer } from "electron";
import type {
	AudioQuality,
	BrowserAccount,
	BundledDocument,
	DownloadRequest,
	MediaCommand,
	MusicCommand,
	MusicQuery,
	NoctuneBridge,
	PersistedState,
	Track,
} from "../src/shared/contracts";

let mediaCommandListener: ((command: MediaCommand) => void) | undefined;
const pendingMediaCommands: MediaCommand[] = [];
const dispatchMediaCommand = (command: MediaCommand) =>
	mediaCommandListener ? mediaCommandListener(command) : pendingMediaCommands.push(command);

ipcRenderer.on("player:media-command", (_event, command: MediaCommand) => dispatchMediaCommand(command));

window.addEventListener(
	"keydown",
	(event) => {
		if (event.key !== " " || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		// A slider's thumb is a hidden range input that takes focus on click, and space types nothing into it,
		// so exempting it is what keeps a seek from silencing the toggle until something else is clicked.
		const typing =
			target?.isContentEditable ||
			(["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "") &&
				(target as HTMLInputElement | null)?.type !== "range");
		if (typing) return;
		if (target?.closest('[role="menu"],[role="menuitem"],[aria-haspopup="menu"]')) return;
		event.preventDefault();
		dispatchMediaCommand({ type: "toggle" });
	},
	true
);

const bridge: NoctuneBridge = {
	auth: {
		state: () => ipcRenderer.invoke("auth:state"),
		browsers: () => ipcRenderer.invoke("auth:browsers"),
		importFromBrowser: (account: BrowserAccount) => ipcRenderer.invoke("auth:import-browser", account),
		importCookies: (cookieHeader: string) => ipcRenderer.invoke("auth:import-cookies", cookieHeader),
		signOut: () => ipcRenderer.invoke("auth:sign-out"),
	},
	music: {
		query: (request: MusicQuery) => ipcRenderer.invoke("music:query", request),
		command: (request: MusicCommand) => ipcRenderer.invoke("music:command", request),
		rating: (trackId: string) => ipcRenderer.invoke("music:rating", trackId),
		accountSettings: () => ipcRenderer.invoke("music:account-settings"),
	},
	player: {
		resolve: (trackId: string, quality: AudioQuality) => ipcRenderer.invoke("player:resolve", trackId, quality),
		onMediaCommand: (listener: (command: MediaCommand) => void) => {
			mediaCommandListener = listener;
			pendingMediaCommands.splice(0).forEach(listener);
			return () => {
				if (mediaCommandListener === listener) mediaCommandListener = undefined;
			};
		},
		position: (positionSeconds: number) => ipcRenderer.send("player:position", positionSeconds),
		notify: (track: Track) => ipcRenderer.invoke("player:notify", track),
	},
	local: {
		load: () => ipcRenderer.invoke("local:load"),
		save: (state: PersistedState) => ipcRenderer.invoke("local:save", state),
		download: (request: DownloadRequest) => ipcRenderer.invoke("local:download", request),
		removeDownload: (trackId) => ipcRenderer.invoke("local:remove-download", trackId),
		clear: (selection) => ipcRenderer.invoke("local:clear", selection),
		exportDiagnostics: () => ipcRenderer.invoke("local:export-diagnostics"),
		downloadsSize: () => ipcRenderer.invoke("local:downloads-size"),
		document: (name: BundledDocument) => ipcRenderer.invoke("local:document", name),
	},
	app: {
		info: () => ipcRenderer.invoke("app:info"),
	},
};

contextBridge.exposeInMainWorld("noctune", bridge);
