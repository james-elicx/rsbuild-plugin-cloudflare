import stylesheet from "./style.css?url";

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = stylesheet;
document.head.append(link);

void fetch("/api/hello")
	.then((response) => response.json() as Promise<{ name: string }>)
	.then(({ name }) => {
		document.body.textContent = `Hello, ${name}!`;
	});
