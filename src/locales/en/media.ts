/** Cards, rows, shelves and track lists shared by every page. */
export const media = {
	explicit: "Explicit",
	paused: "Paused",
	nowPlaying: "Now playing",
	scrollBackward: (title: string) => `Scroll ${title} backward`,
	scrollForward: (title: string) => `Scroll ${title} forward`,
	plays: (count: string) => `${count} plays`,
	columns: {
		name: "Name",
		album: "Album",
		plays: "Plays",
		liked: "Liked",
		disliked: "Disliked",
		duration: "Duration",
	},
	like: "Add to liked songs",
	dislike: "Dislike",
};
