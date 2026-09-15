"use strict";

(() => {
  const DISABLED_KEY = "hide-halloween-facts";
  const facts = [
    "The word Halloween comes from “All Hallows’ Eve,” the evening before All Saints’ Day.",
    "Early jack-o’-lanterns in Ireland and Scotland were commonly carved from turnips instead of pumpkins.",
    "Candy corn appeared in the United States during the 1880s and was once marketed as “Chicken Feed.”",
    "Mary Shelley’s Frankenstein was first published anonymously in 1818.",
    "Bram Stoker’s novel Dracula was published in 1897.",
    "Illusionist Harry Houdini died on Halloween in 1926.",
    "The tradition of wearing costumes has connections to the old practice of guising in Scotland and Ireland.",
    "Black cats became linked with Halloween through centuries of folklore about witches and luck.",
    "Pumpkins are fruits because they grow from flowers and contain seeds.",
    "A group of bats is sometimes called a colony, cloud, or cauldron.",
    "Owls can rotate their heads as much as 270 degrees—not a complete circle.",
    "Día de los Muertos and Halloween occur near the same time, but they are distinct traditions with different histories."
  ];

  const card = document.querySelector("#halloweenFactCard");
  const target = document.querySelector("#halloweenFact");
  const closeButton = document.querySelector("#closeHalloweenFact");
  const disableButton = document.querySelector("#disableHalloweenFacts");
  if (!card || !target || !closeButton || !disableButton) return;

  try {
    if (localStorage.getItem(DISABLED_KEY) === "true") {
      card.classList.add("hidden");
      return;
    }
  } catch {
    // The fact can still be dismissed for this visit when storage is unavailable.
  }

  let previous = -1;
  try { previous = Number.parseInt(sessionStorage.getItem("halloween-fact") || "-1", 10); } catch { /* Use any fact. */ }
  let index = Math.floor(Math.random() * facts.length);
  if (facts.length > 1 && index === previous) index = (index + 1) % facts.length;
  try { sessionStorage.setItem("halloween-fact", String(index)); } catch { /* Rotation still works for this load. */ }
  target.textContent = facts[index];

  closeButton.addEventListener("click", () => card.classList.add("hidden"));
  disableButton.addEventListener("click", () => {
    try { localStorage.setItem(DISABLED_KEY, "true"); } catch { /* Hide it for this visit. */ }
    card.classList.add("hidden");
  });
})();
