import type { EstagioOperacional } from "@prospect/shared";

export interface StatusMeta {
  label: string;
  accentVar: string;
  accentBgVar: string;
  icon: JSX.Element;
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const IconIA = (
  <svg {...iconProps}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </svg>
);

const IconAlert = (
  <svg {...iconProps}>
    <path d="M12 9v4M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);


const IconHeadset = (
  <svg {...iconProps}>
    <path d="M18 8a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

const IconCheck = (
  <svg {...iconProps}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const IconClock = (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const IconFlame = (
  <svg {...iconProps}>
    <path d="M12 2c1 3-2 4-2 7a4 4 0 0 0 8 0c0-1-.5-2-1-2 .5 2-1 3-2 3-2 0-2-2-1-4 .5-1 0-3-2-4z" />
  </svg>
);

const IconBag = (
  <svg {...iconProps}>
    <path d="M6 8h12l-1 12H7L6 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);

const IconTruck = (
  <svg {...iconProps}>
    <rect x="1" y="7" width="13" height="10" rx="1" />
    <path d="M14 10h4l3 3v4h-7z" />
    <circle cx="6" cy="19" r="1.5" />
    <circle cx="17" cy="19" r="1.5" />
  </svg>
);

const IconX = (
  <svg {...iconProps}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** Ícones extras das AÇÕES do card (não de coluna) — ficam aqui junto com os
 * outros pra o Kanban ter um lugar só de ícone. */
const IconChef = (
  <svg {...iconProps}>
    <path d="M6 20h12M7 16h10l1-5a4 4 0 0 0-2-4 4 4 0 0 0-8 0 4 4 0 0 0-2 4l1 5z" />
  </svg>
);

/** Única fonte de verdade de cor/ícone/label por etapa do fluxo — usada no
 * Kanban e na tela de atendimento, pra que a mesma etapa pareça igual em todo
 * lugar. Cinco colunas operacionais + `resolvido`, que nunca é coluna (ver
 * `KANBAN_COLUNAS`): é só o valor de trânsito de quem já saiu do board. */
export const STATUS_META: Record<EstagioOperacional, StatusMeta> = {
  ia_atendendo: {
    label: "IA atendendo",
    accentVar: "var(--ia)",
    accentBgVar: "var(--ia-bg)",
    icon: IconIA,
  },
  aguardando_humano: {
    label: "Aguardando humano",
    accentVar: "var(--orange)",
    accentBgVar: "var(--orange-bg)",
    icon: IconAlert,
  },
  em_atendimento: {
    label: "Em atendimento",
    accentVar: "var(--blue)",
    accentBgVar: "var(--blue-bg)",
    icon: IconHeadset,
  },
  na_cozinha: {
    label: "Na cozinha",
    accentVar: "var(--amber)",
    accentBgVar: "var(--amber-bg)",
    icon: IconChef,
  },
  pronto: {
    label: "Pronto",
    accentVar: "var(--green)",
    accentBgVar: "var(--green-bg)",
    icon: IconBag,
  },
  resolvido: {
    label: "Resolvido",
    accentVar: "var(--gray)",
    accentBgVar: "var(--gray-bg)",
    icon: IconCheck,
  },
};

/** As 5 colunas do Kanban operacional, na ordem do fluxo. `resolvido` não
 * está aqui por definição: atendimento encerrado sai do board. */
export const KANBAN_COLUNAS: EstagioOperacional[] = [
  "ia_atendendo",
  "aguardando_humano",
  "em_atendimento",
  "na_cozinha",
  "pronto",
];

export const ICONES_ACAO = {
  atender: IconHeadset,
  confirmar: IconFlame,
  pronto: IconBag,
  entregar: IconTruck,
  cancelar: IconX,
  relogio: IconClock,
};

export function tempoDecorrido(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export type NivelEspera = "normal" | "atencao" | "critico";

/** Cronômetro de espera, com os três níveis de atenção do board: até 2min é
 * normal, 2–5min pede atenção, 5min+ é crítico. O objetivo é o operador achar
 * rápido quem espera há mais tempo — não é alarme, então o destaque cresce em
 * peso visual, sem animação. */
export function tempoEspera(iso: string): { texto: string; nivel: NivelEspera } {
  const segundosTotais = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const min = Math.floor(segundosTotais / 60);
  const seg = segundosTotais % 60;

  const texto = min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}min` : min >= 1 ? `${min}min ${seg}s` : `${seg}s`;
  const nivel: NivelEspera = min >= 5 ? "critico" : min >= 2 ? "atencao" : "normal";
  return { texto, nivel };
}

/** Duração de um atendimento em curso, no formato mm:ss que o operador lê de
 * relance (ex. "03:21"). */
export function duracaoAtendimento(iso: string): string {
  const segundosTotais = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const h = Math.floor(segundosTotais / 3600);
  const min = Math.floor((segundosTotais % 3600) / 60);
  const seg = segundosTotais % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(min)}:${pad(seg)}` : `${pad(min)}:${pad(seg)}`;
}
