import type { signin as en } from "../en/signin";

export const signin: typeof en = {
	heroTitle: "Un vero player per la tua musica.",
	heroBody:
		"Le tue playlist, i tuoi album e la tua raccolta in un player desktop nativo. Niente schede del browser, niente pubblicità, riproduzione senza pause.",
	continueWith: (name, detail) => (detail ? `Continua con ${name}, ${detail}` : `Continua con ${name}`),
	extensionTitle: "Collega Chrome, Edge, Brave o Vivaldi",
	notSignedInTo: "Accesso non effettuato su",
	extensionWindows:
		"Windows protegge i cookie di questi browser in modo che solo il browser possa leggerli. Nixie Link chiede invece la tua sessione YouTube al browser. ",
	extensionFallback: "Se Nixie non trova il profilo di questo browser, usa Nixie Link. ",
	installBefore: "L'estensione non è negli store dei browser. Segui la ",
	installGuide: "guida all'installazione manuale",
	installAfter: ", poi apri Nixie Link una volta. Il tuo profilo comparirà qui automaticamente.",
	connectedThroughExtension: "Collegato tramite l'estensione",
	pairingCode: "Codice di associazione",
	pairingHint: "Copia questo codice dal popup di Nixie Link.",
	connect: "Collega",
	onlyInApp: "L'accesso è disponibile solo nell'app desktop di Nixie.",
	didNotSignIn: "L'accesso non è riuscito. Riprova.",
	title: "Continua con un browser in cui hai già effettuato l'accesso",
	intro:
		"Nixie riprende la sessione YouTube in cui hai già effettuato l'accesso nel tuo browser. Google non consente di accedere dalla finestra di un'app, quindi qui non te lo chiede mai.",
	accountsNote:
		"Ogni riga indica l'account con cui è stato effettuato l'accesso in quel profilo del browser. Il sistema potrebbe chiederti una volta il permesso di leggere i cookie salvati dal browser. Nixie rilegge quel profilo mentre è in esecuzione, perché Google fa scadere la sessione ogni pochi minuti. I cookie vengono inviati a YouTube e a nessun altro.",
	noFirefoxBefore: "Nessun Firefox con accesso effettuato. Accedi a",
	noFirefoxAfter: "in Firefox, oppure collega Chrome, Edge, Brave o Vivaldi tramite l'estensione qui sopra.",
	noBrowserBefore: "Nessun browser con accesso effettuato. Accedi a",
	noBrowserAfter: "in Chrome, Brave, Edge, Vivaldi o Firefox, poi controlla di nuovo.",
	checkAgain: "Controlla di nuovo",
	disclaimer:
		"Nixie è un client indipendente e non ufficiale, e non è affiliato, approvato o sponsorizzato da Google o YouTube. YouTube e YouTube Music sono marchi di Google LLC. Nixie riproduce solo ciò che l'account che colleghi può già riprodurre, e l'uso di quell'account resta soggetto ai termini di YouTube. Nixie comunica con YouTube tramite l'interfaccia privata usata dalle app di YouTube Music, che YouTube non pubblica né supporta, quindi qualsiasi conseguenza ricade sull'account che colleghi.",
	premium: {
		title: "Nixie richiede Music Premium",
		why: "Nixie riproduce senza pubblicità, in background e con un proprio motore audio. YouTube vende queste funzioni con l'abbonamento Music Premium, quindi Nixie riproduce solo per un account che ce l'ha. L'account che hai collegato non ce l'ha.",
		next: "Un abbonamento attivato sul web viene rilevato alla prossima apertura di Nixie. Se esci da qui, torni alla scelta dell'account.",
		signOut: "Esci",
		openYouTubeMusic: "Apri YouTube Music",
	},
	dataAccess: {
		title: "Consenti a Nixie di leggere il tuo browser",
		why: "Nixie resta collegato leggendo la sessione YouTube salvata nel tuo browser, e la rilegge ogni pochi minuti perché Google continua a sostituirla. macOS sta bloccando questa lettura, quindi non si può riprodurre nulla finché non la consenti.",
		stepOpen: "Apri Impostazioni di Sistema, poi Privacy e sicurezza, poi Accesso completo al disco.",
		stepTurnOn: "Attiva Nixie.",
		stepRestart: "Riavvia Nixie.",
		openSettings: "Apri Impostazioni di Sistema",
		restart: "Riavvia Nixie",
		linkBefore:
			"L'accesso completo al disco permette a Nixie di leggere i file conservati dalle altre app, non solo quelli del tuo browser. Se preferisci non consentirlo, ",
		useLink: "collegati tramite Nixie Link",
		linkAfter: ", che legge invece la sessione attraverso il browser.",
	},
	somethingWentWrong: "Si è verificato un problema",
};
