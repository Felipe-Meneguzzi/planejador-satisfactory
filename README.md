# Planejador Satisfactory

Planejador de fábricas do Satisfactory em formato de diagrama: coloque mineradoras, máquinas, divisores e mescladores, ligue com esteiras e veja na hora quanto passa em cada uma, onde a esteira é fraca, onde sobra ou falta item, e quanto de energia a fábrica consome.

Os dados do jogo (receitas, máquinas, esteiras, overclock, Somersloops) vêm do [wiki oficial](https://satisfactory.wiki.gg), versão **1.2**.

## Rodando com Docker (recomendado)

Precisa só do [Docker](https://docs.docker.com/get-docker/) com Docker Compose.

```bash
git clone <url-do-repositorio>
cd calculadora-satisfactory
docker compose up -d --build
```

Abra **http://localhost:8080**.

| O que fazer | Comando |
|---|---|
| Usar outra porta | `PORT=3000 docker compose up -d --build` |
| Ver os logs | `docker compose logs -f` |
| Parar | `docker compose down` |
| Atualizar depois de um `git pull` | `docker compose up -d --build` |

O container compila o app e serve os arquivos com nginx. A imagem final é pequena e não tem Node.

> Suas plantas ficam salvas **no navegador** (localStorage), não no container. Recriar ou atualizar o container não apaga nada. Pra levar uma planta pra outro navegador/computador, use **Exportar** e **Importar**.

## Rodando sem Docker (desenvolvimento)

Precisa de Node.js 18 ou mais novo.

```bash
npm install
npm run dev      # http://localhost:5173, recarrega sozinho ao editar
npm run build    # gera a versão de produção em dist/
```

## Atalhos

| Atalho | Ação |
|---|---|
| Arrastar da paleta / clicar | Adiciona um node |
| Saída (direita) → entrada (esquerda) | Cria uma esteira |
| `Alt` + arrastar | Alinha ao grid |
| `Shift` + arrastar | Seleciona vários (pega node com ≥ 50% dentro da caixa) |
| `R` / `Shift+R` | Gira o selecionado 90° |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D` | Copia / recorta / cola no mouse / duplica |
| `Ctrl+Z` / `Ctrl+Y` | Desfaz / refaz |
| `Del` | Apaga o selecionado |
| 🏭 **Gerar linha** | Monta uma linha de produção inteira com 100% de eficiência |
