import type { Edge, Node } from '@xyflow/react';

/** slug do nome oficial do item, ex.: 'iron-plate' */
export type ItemId = string;
/** Item carregado por uma esteira: null = vazia, 'mixed' = itens diferentes misturados */
export type BeltItem = ItemId | 'mixed' | null;
export type Purity = 'impure' | 'normal' | 'pure';
export type MinerTier = 1 | 2 | 3;
export type BeltTier = 1 | 2 | 3 | 4 | 5 | 6;
/** Canos: Mk.1 e Mk.2 (o campo `tier` da conexão guarda isso quando ela é um cano) */
export type PipeTier = 1 | 2;
/** Meio de transporte de uma porta: sólido (esteira) ou fluido (cano) */
export type Medium = 'solid' | 'fluid';
/** Tipo de extrator de fluido (o poço de recurso é o node 'well') */
export type ExtractorKind = 'water' | 'oil';
/** slug do nome oficial da máquina, ex.: 'constructor' */
export type MachineId = string;

/** Rotação no sentido horário, em graus (como girar a construção no jogo) */
export type Rotation = 0 | 90 | 180 | 270;

export type MinerData = { kind: 'miner'; resource: ItemId; purity: Purity; tier: MinerTier; clock: number; rotation?: Rotation; collapsed?: boolean };
/** sloops = Somersloops inseridos (amplificação de produção) */
export type MachineData = { kind: 'machine'; machine: MachineId; recipe: string; clock: number; sloops?: number; rotation?: Rotation; collapsed?: boolean };
/** Extrator de fluido (água ou petróleo) */
export type ExtractorData = {
  kind: 'extractor';
  extractor: ExtractorKind;
  resource: ItemId;
  purity: Purity;
  clock: number;
  rotation?: Rotation;
  collapsed?: boolean;
};
/**
 * Poço de recurso: o Resource Well Pressurizer (clock e energia) com seus extratores-satélite.
 * Cada satélite tem a pureza do nó dele e a própria saída de cano (out-0, out-1, ...).
 */
export type WellData = {
  kind: 'well';
  resource: ItemId;
  /** clock do pressurizador: vale pra todos os satélites */
  clock: number;
  satellites: Purity[];
  rotation?: Rotation;
  collapsed?: boolean;
};
/** fluid = junção de cano (Pipeline Junction Cross) em vez de divisor/mesclador de esteira */
export type SplitterData = { kind: 'splitter'; fluid?: boolean; rotation?: Rotation };
export type MergerData = { kind: 'merger'; fluid?: boolean; rotation?: Rotation };
/** Saída final: 'storage' = Armazém (aceita tudo), 'awesome' = AWESOME Sink (só sólidos, vira pontos) */
export type SinkMode = 'storage' | 'awesome';
export type SinkData = { kind: 'sink'; mode?: SinkMode; rotation?: Rotation };
/** slug do nome oficial do gerador, ex.: 'coal-powered-generator' */
export type GeneratorId = string;
/**
 * Gerador de energia. `fuel` = combustível escolhido (entre os aceitos por ele);
 * `purity` = pureza do gêiser (só Geothermal Generator).
 */
export type GeneratorData = {
  kind: 'generator';
  generator: GeneratorId;
  fuel?: ItemId;
  clock: number;
  purity?: Purity;
  rotation?: Rotation;
  collapsed?: boolean;
};
/** Fábrica + node de outra fábrica (Saída externa) de onde uma Entrada externa puxa */
export type ExternalLink = { factory: string; node: string };
/**
 * Entrada externa: item que chega de fora da fábrica. `rate` é a vazão manual; com `link`,
 * a vazão vem do que chega na Saída externa ligada (a manual vale quando não dá pra usar o link).
 */
export type InboundData = { kind: 'inbound'; item: ItemId; rate: number; link?: ExternalLink; rotation?: Rotation; collapsed?: boolean };
/** Saída externa: recebe qualquer item (como o Armazém) e pode alimentar Entradas externas de outras fábricas */
export type OutboundData = { kind: 'outbound'; name?: string; rotation?: Rotation };
export type FactoryData = MinerData | ExtractorData | WellData | MachineData | SplitterData | MergerData | SinkData | GeneratorData | InboundData | OutboundData;

export type MinerNode = Node<MinerData, 'miner'>;
export type ExtractorNode = Node<ExtractorData, 'extractor'>;
export type WellNode = Node<WellData, 'well'>;
export type MachineNode = Node<MachineData, 'machine'>;
export type SplitterNode = Node<SplitterData, 'splitter'>;
export type MergerNode = Node<MergerData, 'merger'>;
export type SinkNode = Node<SinkData, 'sink'>;
export type GeneratorNode = Node<GeneratorData, 'generator'>;
export type InboundNode = Node<InboundData, 'inbound'>;
export type OutboundNode = Node<OutboundData, 'outbound'>;
export type FactoryNode = MinerNode | ExtractorNode | WellNode | MachineNode | SplitterNode | MergerNode | SinkNode | GeneratorNode | InboundNode | OutboundNode;

/** 'grid' = ângulos retos alinhados ao grid; 'curve' = curva livre. Sem valor = segue o padrão global */
export type BeltRouting = 'grid' | 'curve';
export type BeltData = {
  tier: BeltTier;
  routing?: BeltRouting;
  /** viradas de um trajeto feito pelo gerador: coordenadas alternando eixo (começa pelo eixo de saída) */
  bends?: number[];
  /** pontas [sx, sy, tx, ty] quando o trajeto foi gerado; se um node mexer, o trajeto é descartado */
  anchor?: [number, number, number, number];
};
/** Conexão entre máquinas: 'belt' = esteira (sólidos), 'pipe' = cano (fluidos) */
export type BeltEdge = Edge<BeltData, 'belt' | 'pipe'>;
