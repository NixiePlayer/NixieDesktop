import { main as english } from "../locales/en/main";
import { main as italian } from "../locales/it/main";
import type { AppInfo } from "./contracts";

const errorNames = new Set([
	"Error",
	"TypeError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"URIError",
	"AggregateError",
	"AbortError",
	"TimeoutError",
	"NetworkError",
	"NotAllowedError",
	"NotFoundError",
	"SecurityError",
	"MediaError",
	"InnertubeError",
	"ParsingError",
	"MissingParamError",
]);
const errorCodes = new Set([
	"EACCES",
	"EPERM",
	"ENOENT",
	"EBUSY",
	"ENOSPC",
	"EROFS",
	"EIO",
	"EADDRINUSE",
	"ECONNREFUSED",
	"ECONNRESET",
	"ENOTFOUND",
	"EAI_AGAIN",
	"ETIMEDOUT",
	"ENETUNREACH",
	"EHOSTUNREACH",
	"CERT_HAS_EXPIRED",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"ERR_CERT_AUTHORITY_INVALID",
	"ERR_INTERNET_DISCONNECTED",
	"ERR_NETWORK_CHANGED",
	"ERR_CONNECTION_RESET",
	"ERR_CONNECTION_REFUSED",
	"ERR_NAME_NOT_RESOLVED",
	"MEDIA_ERR_ABORTED",
	"MEDIA_ERR_NETWORK",
	"MEDIA_ERR_DECODE",
	"MEDIA_ERR_SRC_NOT_SUPPORTED",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_SOCKET",
	"ERR_SQLITE_ERROR",
]);

export interface DiagnosticError {
	name: string;
	code?: string;
	status?: number;
}

/** Only allowlisted metadata crosses into logs. Messages, stacks and payloads never do. */
export function diagnosticError(error: unknown): DiagnosticError {
	const value = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
	const cause = value.cause && typeof value.cause === "object" ? (value.cause as Record<string, unknown>) : {};
	const code = [value.code, cause.code].find(
		(candidate) =>
			typeof candidate === "string" && (errorCodes.has(candidate) || /^ERR_UPDATER_[A-Z_]+$/.test(candidate))
	);
	// electron-updater wraps its HTTP failures as `HttpError: 504` inside the message and keeps `statusCode`.
	const status =
		value.status ??
		value.statusCode ??
		(typeof value.message === "string"
			? Number(/\b(?:status code|HttpError:) ([45]\d{2})\b/.exec(value.message)?.[1])
			: undefined);
	return {
		name: typeof value.name === "string" && errorNames.has(value.name) ? value.name : "Error",
		code: typeof code === "string" ? code : undefined,
		status:
			typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined,
	};
}

export function diagnosticReason(error: unknown) {
	const { name, code, status } = diagnosticError(error);
	const message = error && typeof error === "object" && "message" in error ? error.message : undefined;
	const reason = (Object.keys(english.errors) as (keyof typeof english.errors)[]).find(
		(key) => message === english.errors[key] || message === italian.errors[key]
	);
	return [name, code, status && `HTTP ${status}`, reason].filter(Boolean).join(" / ");
}

export function diagnosticReport(info: AppInfo, details: string, events: string) {
	return [
		"## Nixie diagnostics",
		`Nixie: ${info.version}`,
		`OS: ${info.os} (${info.arch})`,
		`Electron: ${info.electron}; Chromium: ${info.chrome}`,
		details,
		"",
		"Recent events (oldest first; no account names, paths, URLs or raw error messages):",
		events || "No events recorded.",
	].join("\n");
}

/** Keep the URL short enough for Windows browser handoff. The full report is copied separately. */
export function diagnosticIssueUrl(report: string) {
	return `https://github.com/NixiePlayer/NixieDesktop/issues/new?${new URLSearchParams({
		title: "Nixie error report",
		body: `## What happened?\n\nDescribe the problem and the steps to repeat it.\n\n${report.split("\n").slice(0, 6).join("\n")}\n\n## Recent errors\n\nPaste the diagnostic report copied by Nixie here.\n`,
	})}`;
}
