## Reversi Multiplayer Game

Othello/Reversi с тремя режимами:

- **Player vs AI** (Easy / Normal / Hard)
- **Local 1v1** (два игрока за одним устройством)
- **Online 1v1** (через Socket.IO с room code)

## Запуск локально

```bash
cd server
npm install
npm start
```

Откройте `http://localhost:3000`.

## Что улучшено

- Улучшен AI: random на Easy и minimax + позиционные веса на Normal/Hard.
- Онлайн-режим с созданием комнаты и подключением по коду.
- Корректная обработка правил Reversi: только валидные ходы, pass turn при отсутствии ходов, честный game over.
- Обновлён UI: более понятная панель, подсказки ходов, анимации фишек и подсветка.
