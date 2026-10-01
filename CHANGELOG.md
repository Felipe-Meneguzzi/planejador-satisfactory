# Changelog

## 0.2.0 — roadmap de expansão (2026-10-01)

### Novidades
- **Energia de verdade**: geradores (Biomass Burner, Coal, Fuel, Nuclear, Geothermal, Alien Power Augmenter) com combustível, água e resíduo; saldo de energia na barra e no painel; "Falta energia" quando a geração não cobre o consumo.
- **Poço de recurso**: pressurizador com clock, energia e Power Shards, e extratores-satélite com pureza própria (plantas antigas são migradas sozinhas).
- **AWESOME Sink**: pontos/min e /h, custo do próximo cupom e estimativa de cupons/h; fluido é recusado.
- **Várias fábricas** em abas, com desfazer/refazer e zoom por fábrica, copiar/colar entre abas, **Entrada/Saída externa** ligando fábricas e **resumo do projeto**.
- **Exportar/importar** o projeto inteiro ou só a fábrica atual, e **compartilhar por link** (comprimido no endereço).
- **Otimizador** no gerador de linha: programação linear que escolhe receitas, **reaproveita subprodutos**, otimiza por recursos, máquinas ou energia, e tem o modo **"Maximizar com o que eu tenho"**.
- **Editor**: reconectar a ponta de uma esteira/cano arrastando, **molduras** coloridas e **anotações**, **busca rápida (Ctrl+K)** e títulos dos cards sem cortar.
- **Proteção contra travamento**: painel de recuperação em vez de tela branca, salvamento só de estado válido e backup das últimas versões (botão 🕘).
- **Testes automatizados** (Vitest + Playwright) e **CI** no GitHub Actions (tipos, testes, build, E2E e `docker build`).

### Correções
- Mensagem "Esteira fraca" com a concordância certa; botão de correção de cano mostra o nome do cano.
- IDs nunca se repetem, mesmo quando o gerador cria centenas de nodes de uma vez.
- Receita padrão do gerador é a que leva o nome do item (ex.: Rubber, não Residual Rubber).
- Simulação resolve o ponto fixo em duas fases: linhas que reaproveitam subproduto dão partida como no jogo.

### Limitações conhecidas
- Biomass Burner considerado sempre no clock escolhido (no jogo ele reduz o consumo conforme a demanda); Geothermal usa a média da pureza.
- Game Modes da 1.2 (multiplicadores de energia/custo) não são considerados.
- No otimizador com "todas as receitas": Encased Plutonium Cell gera uma linha que a simulação não fecha (a janela avisa) e Alien Power Matrix, Superposition Oscillator e Non-Fissile Uranium dão erro de laço que não dá partida sozinho.
- Moldura não minimiza, e mover a moldura pelas setas do teclado não leva o conteúdo junto.
