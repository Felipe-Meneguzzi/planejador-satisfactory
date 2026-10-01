# Planejador Satisfactory

Planejador de fábricas do Satisfactory em formato de diagrama: coloque mineradoras, máquinas, divisores e mescladores, ligue com esteiras e veja na hora quanto passa em cada uma, onde a esteira é fraca, onde sobra ou falta item, e quanto de energia a fábrica consome.

Os dados do jogo (receitas, máquinas, esteiras, overclock, Somersloops, geradores, poços de recurso e pontos do AWESOME Sink) vêm do [wiki oficial](https://satisfactory.wiki.gg), versão **1.2**.

## Energia, poços e AWESOME Sink

- **Geradores** (paleta → Energia): Biomass Burner, Coal-Powered, Fuel-Powered, Nuclear, Geothermal e Alien Power Augmenter. Consumo de combustível, água e resíduo escalam 1:1 com o clock; faltando insumo, o gerador gera proporcionalmente menos e acusa "Falta …". A barra de cima mostra `consumo / geração` e o painel lateral traz o saldo, o uso da rede e os insumos por minuto. Sem nenhum gerador na planta, a energia é considerada externa (só o consumo aparece).
- **Simplificações**: o Biomass Burner queima sempre no clock escolhido (no jogo ele queima menos quando a rede pede menos); o Geothermal usa a média da pureza (no jogo oscila entre 0,5× e 1,5×); Alien Power Augmenter com Alien Power Matrix parcial conta o bônus proporcional (entre +10% e +30%).
- **Poço de recurso**: um node com o Resource Well Pressurizer (clock e energia, 150 MW × clock^1,321928) e a lista de extratores-satélite, cada um com a sua pureza e o seu cano. Plantas antigas com o "extrator de poço" abrem como um poço de um satélite. O gerador de linha divide os satélites em poços de até N satélites, onde N é a média de satélites por poço daquele recurso no mapa, arredondada pra cima (Nitrogen Gas 8, Crude Oil 6, Water 7).
- **AWESOME Sink**: modo da saída que só aceita sólidos (cano é recusado) e mostra os pontos/min; o painel soma os pontos da planta e estima os cupons por hora a partir dos cupons já impressos. Itens sem pontos (ex.: Uranium Waste) travam a esteira e geram aviso.

## Várias fábricas

- **Abas**: cada aba é uma fábrica, com os próprios nodes, esteiras, histórico de desfazer/refazer e zoom/posição (lembrados ao trocar de aba). `+` cria uma fábrica, duplo clique renomeia, arrastar reordena e o menu `⋯` da aba aberta renomeia, duplica, move ou apaga (com confirmação). O badge da aba mostra quantos erros/avisos ela tem.
- **Copiar/colar entre abas**: `Ctrl+C` numa fábrica e `Ctrl+V` em outra. O gerador de linha sempre entra na aba aberta.
- **Saída externa** (paleta → Entre fábricas): recebe qualquer item, como o Armazém, e mostra pra quais fábricas ele vai.
- **Entrada externa**: item que chega de fora, com vazão manual. Em "Vem de", ligue numa Saída externa de outra fábrica: a vazão passa a ser o que efetivamente chega naquela saída. As fábricas são simuladas na ordem das dependências (quem manda antes de quem recebe).
- **Avisos entre fábricas**: entrada pedindo mais do que a saída manda, item diferente, saída sem nenhuma entrada ligada, saída apagada e ciclo entre fábricas (A manda pra B que manda pra A: aí a entrada usa a vazão manual).
- **📊 Projeto** (à direita das abas): resumo por fábrica e no total — energia (consumo/geração), máquinas, o que cada uma importa e exporta, produção final, pontos do AWESOME Sink, o que vem de fora do projeto e o que sai sem destino.
- **Gerador de linha**: insumos que não dá pra produzir (coletáveis como Mycelia, Hatcher Remains, Blue Power Slug) viram Entradas externas já ligadas às faixas que precisam deles, com a vazão exata — a linha continua sem erros nem avisos.
- **Simplificações**: a Saída externa leva tudo o que chega (sem back-pressure da fábrica de destino); várias entradas ligadas na mesma saída dividem a vazão igualmente; a energia do resumo soma todas as fábricas como se estivessem na mesma rede.

## Exportar, importar e compartilhar

- **📁 Arquivo → Exportar**: o projeto inteiro (`projeto-satisfactory-AAAA-MM-DD.json`) ou só a fábrica aberta (`fabrica-<nome>-AAAA-MM-DD.json`).
- **📁 Arquivo → Importar**: aceita projeto, fábrica avulsa ou planta do formato antigo (versão 1, de uma fábrica só). Antes de mexer em qualquer coisa, pergunta se **adiciona como nova(s) fábrica(s)** ou **substitui o projeto** (o projeto atual fica nas versões anteriores 🕘). Arquivo inválido mostra o motivo e não muda nada.
- **🔗 Compartilhar**: gera um link com a fábrica aberta ou o projeto inteiro comprimido no próprio link (`#share=…`, nada vai pra servidor), com botão de copiar. Quem abre o link vê o que veio e escolhe entre adicionar ou substituir; o link some da barra de endereço depois. Acima de ~8 mil caracteres o app avisa que o link pode ser cortado e sugere exportar o arquivo.
- O salvamento automático guarda o projeto inteiro (formato versão 2). Plantas salvas, backups e arquivos da versão 1 abrem sozinhos como um projeto de uma fábrica.

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

> Seus projetos ficam salvos **no navegador** (localStorage), não no container. Recriar ou atualizar o container não apaga nada. Pra levar um projeto pra outro navegador/computador, use **📁 Arquivo → Exportar/Importar** ou **🔗 Compartilhar**.

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
| 🏭 **Gerar linha** | Monta uma linha de produção inteira com 100% de eficiência (na aba aberta) |
| `+` nas abas / duplo clique na aba | Nova fábrica / renomeia |
| Arrastar a aba / menu `⋯` | Reordena / renomeia, duplica, move, apaga |
| `Ctrl+C` numa aba, `Ctrl+V` em outra | Copia nodes entre fábricas |
| 📊 **Projeto** | Resumo do projeto inteiro |
| 📁 **Arquivo** | Exportar projeto ou fábrica, importar, exemplo numa fábrica nova, limpar a fábrica aberta |
| 🔗 **Compartilhar** | Link com a fábrica aberta ou o projeto inteiro |
