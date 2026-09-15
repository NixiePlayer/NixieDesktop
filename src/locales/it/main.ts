import type { main as en } from "../en/main";

export const main: typeof en = {
	exportDiagnostics: "Esporta diagnostica",
	playback: "Riproduzione",
	startupFailed: "Impossibile avviare Nixie",
	unknownStartupError: "Errore di avvio sconosciuto",
	errors: {
		unentitled: "Quell'account non ha un abbonamento YouTube Music Premium, che è necessario per usare Nixie",
		notSignedIn: "In quel profilo non è stato effettuato l'accesso a YouTube",
		secureStorage: "L'archiviazione sicura non è disponibile su questo computer",
		unlockKeyringToPair: "Sblocca un portachiavi di sistema prima di associare l'estensione",
		browserGone: "Quel browser non è più collegato",
		dataAccessRefused:
			"macOS ha negato a Nixie l'accesso ai dati del browser. Consenti Nixie in Impostazioni di Sistema, Privacy e sicurezza, Accesso completo al disco, poi riavvia Nixie",
		keyringLocked: "Nixie non è riuscito a leggere il portachiavi di sistema. Sbloccalo e riprova.",
		keyringMissing: "Nixie non è riuscito a leggere il portachiavi di sistema. Installa libsecret-tools e riprova.",
		unsupportedProfile: "Profilo del browser non supportato",
		invalidPairingCode: "Codice di associazione dell'estensione non valido",
		extensionNotConnected: "Estensione non collegata",
		extensionTimedOut: "L'estensione non ha risposto in tempo",
		extensionDisconnected: "Estensione scollegata",
	},
};
