import type { settings as en } from "../en/settings";

export const settings: typeof en = {
	title: "Impostazioni",
	tabs: { general: "Generali", playback: "Riproduzione", privacy: "Privacy", about: "Info" },
	scope: { computer: "Su questo computer", account: "Il tuo account · tutti i dispositivi" },
	general: {
		description: "L'aspetto di Nixie e cosa gli invia YouTube Music.",
		theme: {
			label: "Tema",
			description: "Sistema segue l'aspetto del tuo dispositivo.",
			dark: "Scuro",
			light: "Chiaro",
			system: "Sistema",
			always: "Sempre",
			followsDevice: "Segue il dispositivo",
		},
		language: {
			label: "Lingua",
			description:
				"Sistema segue la lingua del tuo dispositivo. Anche YouTube Music risponde in questa lingua, quindi i titoli delle sezioni e i generi la seguono.",
			system: "Lingua del sistema",
			en: "English",
			it: "Italiano",
		},
		notify: {
			label: "Notifica al cambio brano",
			description:
				"Indica il brano successivo quando la coda avanza da sola. Non viene mostrato nulla mentre stai usando Nixie.",
			refused: "Il sistema ha bloccato l'ultima notifica.",
			hint: {
				darwin: "Consenti le notifiche per Nixie in Impostazioni di Sistema, alla voce Notifiche.",
				win32:
					"Consenti le notifiche per Nixie in Impostazioni, alla voce Sistema e poi Notifiche, e verifica che Non disturbare sia disattivato.",
				linux:
					"Consenti le notifiche per Nixie nelle impostazioni di notifica del tuo desktop, e verifica che un servizio di notifiche sia attivo.",
			},
		},
		region: {
			label: "Paese dei contenuti",
			description: "Decide quali classifiche, nuove uscite e consigli ti vengono mostrati. Non è la lingua dell'app.",
			automatic: "Scelta da YouTube",
		},
		restricted: {
			label: "Modalità con restrizioni",
			description:
				"Nasconde brani e video con contenuti potenzialmente per adulti. Nessun filtro è perfetto. YouTube la memorizza per ogni app e non nel tuo account, quindi vale solo per Nixie.",
		},
		likedFromYouTube: {
			label: "Musica che ti piace da YouTube",
			description:
				"Mostra nella playlist Musica che ti piace i video musicali a cui hai messo Mi piace nelle altre app YouTube.",
		},
	},
	playback: {
		description: "Come Nixie riproduce in streaming e livella quello che ascolti.",
		normalization: {
			label: "Normalizzazione del volume",
			description: (maxBoostDb) =>
				`Mantiene i brani a un volume simile, usando i livelli misurati da YouTube. I brani bassi vengono alzati verso l'obiettivo e quelli alti abbassati, con un aumento massimo di ${maxBoostDb} dB per non distorcere.`,
			quiet: (lufs) => `Basso (${lufs} LUFS)`,
			normal: (lufs) => `Normale (${lufs} LUFS)`,
			loud: (lufs) => `Alto (${lufs} LUFS)`,
		},
		autoplay: {
			label: "Riproduzione automatica",
			description:
				"Continua a suonare quando la coda finisce, con una radio che YouTube Music genera dal brano appena terminato. Se la disattivi, Nixie si ferma alla fine della coda.",
		},
		quality: {
			label: "Qualità audio",
			description: "Opus è preferito, AAC è l'alternativa.",
			low: "Risparmio dati",
			normal: "Bilanciata",
			high: "Massima disponibile",
		},
		dynamicQueue: {
			label: "Coda dinamica",
			description: "Permette a YouTube Music di aggiornare code e radio man mano che impara cosa ascolti.",
		},
	},
	privacy: {
		description:
			"Nixie non ha servizi di account, backend, telemetria o cache dei contenuti. Nulla lascia questo dispositivo, tranne quello che le voci qui sotto inviano all'account che hai collegato.",
		reportHistory: {
			label: "Segnala gli ascolti a YouTube",
			description:
				"Comunica a YouTube Music cosa hai ascoltato, ed è questo che personalizza la tua Home. Se la disattivi, la Home resta basata su quello che sa già di te.",
		},
		diagnostics: {
			label: "Diagnostica",
			description:
				"Scrive un file di log con gli eventi di riproduzione e di sessione. Cookie, URL degli stream, percorsi dei file e testi vengono oscurati.",
			action: "Esporta",
		},
		localData: {
			label: "Dati locali",
			description: "Rimuove la coda, le impostazioni e l'account del browser collegato, quindi ti disconnette.",
			action: "Cancella",
		},
		pauseWatchHistory: {
			label: "Metti in pausa la cronologia visualizzazioni",
			description:
				"Impedisce a YouTube di registrare cosa ascolti, in tutte le app connesse a questo account. Può volerci un momento prima che abbia effetto.",
		},
		pauseSearchHistory: {
			label: "Metti in pausa la cronologia delle ricerche",
			description: "Impedisce a YouTube di registrare cosa cerchi, in tutte le app connesse a questo account.",
		},
		manageHistory: {
			label: "Gestisci o elimina la cronologia",
			description:
				"Controlla e rimuovi quello che YouTube ha registrato. L'eliminazione è definitiva e vale per tutti i dispositivi.",
		},
	},
	about: {
		description: "Cos'è questa build e come segnalarci un problema.",
		readingBuild: "Lettura della build in corso.",
		copy: "Copia",
		versionCopied: "Versione copiata",
		reportIssue: {
			label: "Segnala un problema",
			description:
				"Controlla e copia gli errori recenti, oppure apri una issue su GitHub con le informazioni sull'app e sul sistema.",
		},
		disclaimer:
			"Nixie è un client indipendente e non ufficiale e non è affiliato, approvato o sponsorizzato da Google o YouTube. YouTube e YouTube Music sono marchi di Google LLC. Non è un prodotto YouTube Music e non ne riproduce né ne imita uno: riproduce ciò che l'account che hai collegato può già riprodurre e non memorizza alcun contenuto multimediale proprio.",
		documents: {
			license: { title: "Licenza", description: "Nixie è distribuito con licenza MIT." },
			privacy: {
				title: "Privacy",
				description: "Cosa viene memorizzato su questo computer e l'unica cosa che ne esce.",
			},
			security: {
				title: "Sicurezza",
				description: "Come l'app è isolata in sandbox e come segnalare una vulnerabilità.",
			},
			notices: { title: "Note di terze parti", description: "I progetti e le fonti dei testi da cui dipende Nixie." },
			licenses: {
				title: "Licenze di terze parti",
				description: "La licenza di ogni pacchetto open source incluso in questa build.",
			},
		},
		youtubeAndGoogle: "YouTube e Google",
		terms: {
			label: "Termini di servizio di YouTube",
			description: "I termini che regolano l'account tramite cui Nixie riproduce.",
		},
		googlePrivacy: {
			label: "Norme sulla privacy di Google",
			description: "Come Google gestisce i dati di quell'account.",
		},
		youtubeMusic: { description: "L'app ufficiale, dove puoi cambiare anche tutte le impostazioni dell'account." },
	},
	document: {
		reading: "Lettura…",
		unreadable: (name) => `Nixie non è riuscito a leggere ${name} da questa build.`,
	},
	account: {
		openSettings: "Apri le impostazioni di YouTube Music",
		notSaved: "YouTube Music non ha salvato la modifica",
		unavailable:
			"Nixie non è riuscito a raggiungere le impostazioni del tuo account. Puoi comunque cambiarle su YouTube Music.",
	},
	update: {
		restartNow: "Riavvia ora",
		downloading: {
			label: (version) => `Download di Nixie ${version}`,
			description: "Continua ad ascoltare, avviene in background.",
		},
		unsupported: {
			label: "Controlla aggiornamenti",
			description: "Una build di sviluppo non ha un feed delle release, quindi qui non arriva nessuna risposta.",
			action: "Controlla ora",
		},
		checking: {
			label: "Controllo aggiornamenti",
			description: "Chiedo a GitHub qual è l'ultima release.",
			action: "In corso",
		},
		current: { label: "Nixie è aggiornato", description: "Questa è l'ultima release.", action: "Ricontrolla" },
		ready: {
			label: (version) => `Nixie ${version} è pronto`,
			description: "Riavviando lo installi, e lo stesso succede quando chiudi Nixie più tardi.",
		},
		error: {
			label: "Impossibile controllare gli aggiornamenti",
			description: "Impossibile raggiungere GitHub. Tutte le release sono comunque disponibili nel repository.",
		},
		toast: {
			anyReady: "Un aggiornamento è pronto",
			description: "Riavvia per installarlo, oppure continua ad ascoltare e verrà installato alla prossima chiusura.",
		},
	},
};
