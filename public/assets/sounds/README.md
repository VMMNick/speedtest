# Звуки

Звук завершення тесту синтезується через Web Audio API (`playChime()` в `src/app.js`),
тому окремі файли не потрібні. Щоб використати власний семпл — покладіть сюди
`complete.mp3` і замініть `playChime()` на `new Audio('/assets/sounds/complete.mp3').play()`.
