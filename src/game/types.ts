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
/** Tipo de extrator de fluido */
export type ExtractorKind = 'water' | 'oil' | 'well';
/** slug do nome oficial da máquina, ex.: 'constructor' */
export type MachineId = string;

/** Rotação no sentido horário, em graus (como girar a construção no jogo) */
export type Rotation = 0 | 90 | 180 | 270;

export type MinerData = { kind: 'miner'; resource: ItemId; purity: Purity; tier: MinerTier; clock: number; rotation?: Rotation; collapsed?: boolean };
/** sloops = Somersloops inseridos (amplificação de produção) */
export type MachineData = { kind: 'machine'; machine: MachineId; recipe: string; clock: number; sloops?: number; rotation?: Rotation; collapsed?: boolean };
/** Extrator de fluido (água, petróleo ou poço de recurso) */
export type ExtractorData = {
  kind: 'extractor';
  extractor: ExtractorKind;
  resource: ItemId;
  purity: Purity;
  clock: number;
  rotation?: Rotation;
  collapsed?: boolean;
};
/** fluid = junção de cano (Pipeline Junction Cross) em vez de divisor/mesclador de esteira */
export type SplitterData = { kind: 'splitter'; fluid?: boolean; rotation?: Rotation };
export type MergerData = { kind: 'merger'; fluid?: boolean; rotation?: Rotation };
export type SinkData = { kind: 'sink'; rotation?: Rotation };
export type FactoryData = MinerData | ExtractorData | MachineData | SplitterData | MergerData | SinkData;

export type MinerNode = Node<MinerData, 'miner'>;
export type ExtractorNode = Node<ExtractorData, 'extractor'>;
export type MachineNode = Node<MachineData, 'machine'>;
export type SplitterNode = Node<SplitterData, 'splitter'>;
export type MergerNode = Node<MergerData, 'merger'>;
export type SinkNode = Node<SinkData, 'sink'>;
export type FactoryNode = MinerNode | ExtractorNode | MachineNode | SplitterNode | MergerNode | SinkNode;

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
