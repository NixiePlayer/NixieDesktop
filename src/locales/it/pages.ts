import type { pages as en } from "../en/pages";

export const pages: typeof en = {
	home: {
		empty: "Il tuo feed Home di YouTube Music non ha ancora niente da mostrare.",
		filters: "filtri",
	},
	explore: {
		title: "Esplora",
		shortcuts: "Scorciatoie di Esplora",
		chartRegion: "Paese della classifica",
		empty: "Al momento YouTube Music non ha niente da mostrare qui.",
		newReleases: "Nuove uscite",
		charts: "Classifiche",
	},
	search: {
		title: "Cerca",
		resultsFor: (query) => `Risultati per ${query}`,
		all: "Tutti",
		topResult: "Risultato migliore",
		fansMightAlsoLike: "Potrebbero piacerti anche",
		moreResults: "Altri risultati",
		noResults: "Nessun risultato. Prova con meno parole o con un altro filtro.",
		prompt: "Cerca qualsiasi cosa su YouTube Music.",
		// Italian agrees in gender, so the kind picks the article. A release keeps upstream's own word
		// ("Singolo", "EP", "Album"), all masculine, lowercased unless it is an acronym.
		fromThis: (kind, label) => {
			if (kind === "album") return `Da questo ${label === label.toUpperCase() ? label : label.toLowerCase()}`;
			return {
				song: "Da questo brano",
				episode: "Da questa puntata",
				artist: "Da questo artista",
				podcast: "Da questo podcast",
				playlist: "Da questa playlist",
			}[kind];
		},
	},
	library: {
		title: "Raccolta",
		all: "Tutti",
		empty: "Non c'è ancora niente qui.",
	},
	artist: {
		mix: "Mix",
		subscribe: "Iscriviti",
		subscribed: "Iscritto",
		seeMore: "Mostra altro",
		seeLess: "Mostra meno",
		releases: "Uscite",
	},
};
