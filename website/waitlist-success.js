import { navigateWithTransition } from "./transitions.js";

document.getElementById("success-close").addEventListener("click", () => {
  navigateWithTransition("/");
});
