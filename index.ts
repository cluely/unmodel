import { image } from "unmodel/image";

const validated = image({
	model: "openai/gpt-image-2",
	prompt: "",
	size: "3840x1280",
	background: "transparent",
});
