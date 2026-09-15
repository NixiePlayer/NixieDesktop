import type { media as en } from "../en/media";

export const media: typeof en = {
	explicit: "Esplicito",
	paused: "In pausa",
	nowPlaying: "In riproduzione",
	scrollBackward: (title) => `Scorri ${title} indietro`,
	scrollForward: (title) => `Scorri ${title} avanti`,
	plays: (count) => `${count} riproduzioni`,
	columns: {
		name: "Titolo",
		album: "Album",
		plays: "Riproduzioni",
		liked: "Mi piace",
		disliked: "Non mi piace",
		duration: "Durata",
	},
	like: "Mi piace",
	dislike: "Non mi piace",
};
