const fs = require("fs");
const s = fs.readFileSync(
  process.env.LOCALAPPDATA +
    "/Programs/cursor/resources/app/extensions/git/dist/main.js",
  "utf8",
);
const p = s.indexOf("gn=class");
console.log(s.slice(p, p + 500));
console.log("--- branch ---");
const b = s.indexOf("async branch(");
console.log(s.slice(b, b + 400));
