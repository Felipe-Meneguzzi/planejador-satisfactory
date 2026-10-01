# Planejador Satisfactory

Planejador de fábricas do Satisfactory em formato de diagrama: coloque mineradoras, máquinas, divisores e mescladores, ligue com esteiras e veja na hora quanto passa em cada uma, onde a esteira é fraca, onde sobra ou falta item, e quanto de energia a fábrica consome.

Os dados do jogo (receitas, máquinas, esteiras, overclock, Somersloops, geradores, poços de recurso e pontos do AWESOME Sink) vêm do [wiki oficial](https://satisfactory.wiki.gg), versão **1.2**.

## Energia, poços e AWESOME Sink

- **Geradores** (paleta → Energia): Biomass Burner, Coal-Powered, Fuel-Powered, Nuclear, Geothermal e Alien Power Augmenter. Consumo de combustível, água e resíduo escalam 1:1 com o clock; faltando insumo, o gerador gera proporcionalmente menos e acusa "Falta …". A barra de cima mostra `consumo / geração` e o painel lateral traz o saldo, o uso da rede e os insumos por minuto. Sem nenhum gerador na planta, a energia é considerada externa (só o consumo aparece).
- **Simplificações**: o Biomass Burner queima sempre no clock escolhido (no jogo ele queima menos quando a rede pede menos); o Geothermal usa a média da pureza (no jogo oscila entre 0,5× e 1,5×); Alien Power Augmenter com Alien Power Matrix parcial conta o bônus proporcional (entre +10% e +30%).
- **Poço de recurso**: um node com o Resource Well Pressurizer (clock e energia, 150 MW × clock^1,321928) e a lista de extratores-satélite, cada um com a sua pureza e o seu cano. Plantas antigas com o "extrator de poço" abrem como um poço de um satélite. O gerador de linha divide os satélites em poços de até N satélites, onde N é a média de satélites por poço daquele recurso no mapa, arredondada pra cima (Nitrogen Gas 8, Crude Oil 6, Water 7).
- **AWESOME Sink**: modo da saída que só aceita sólidos (cano é recusado) e mostra os pontos/min; o painel soma os pontos da planta e estima os cupons por hora a partir dos cupons já impressos. Itens sem pontos (ex.: Uranium Waste) travam a esteira e geram aviso.

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

## Testes

| Comando | O que roda |
|---|---|
| `npm test` | Testes unitários (Vitest): simulação, cálculo da linha e aceitação do gerador sem browser |
| `npm run test:watch` | Os mesmos, rodando de novo a cada alteração |
| `npm run test:e2e` | Testes E2E (Playwright) no Chromium; sobe o Vite sozinho na porta 4174 |

Na primeira vez, baixe o navegador do Playwright com `npx playwright install chromium`. O CI (GitHub Actions) roda tipos, testes, build, E2E e o `docker build` a cada push e pull request.

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
