# Arquivos do mapa

- `map.jpg`: o mapa do jogo (4096 px, só a área jogável: X de -324.699 a 425.302 e Y de -375.000 a 375.000).
- `map-icons/`: os ícones de marcador do jogo, um por `IconID` do save.
- `../src/map/catalog.json`: todos os itens do mundo (HDs, Somersloops, Esferas, lesmas, nós, poços…).
  Gerado por `scripts/build-map-catalog.mjs`.

Tudo isso vem do [satisfactory-calculator.com](https://satisfactory-calculator.com/) (tiles `imgMap/gameLayer`,
ícones e o JSON de `mapData`), baixado para **uso pessoal**. O site não tem código aberto e a arte do jogo é da
Coffee Stain Studios; não redistribua este projeto com esses arquivos.
