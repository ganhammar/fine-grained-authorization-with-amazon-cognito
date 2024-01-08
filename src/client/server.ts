import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFile } from "fs";
import { join } from "path";

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = req.url?.split("?")[0];
  if (url === "/" || url === "/index.html") {
    readFile(
      join(__dirname, "index.html"),
      (err: NodeJS.ErrnoException | null, data: Buffer) => {
        if (err) {
          res.writeHead(500);
          res.end("Error loading index.html");
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(data);
        }
      }
    );
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

const port = 3000;
server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
