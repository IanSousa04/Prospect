// Configuração de aparência da página pública de pedido (tarefa da aba
// "Página pública"). Guardada em `ia_configuracoes.publico_json` — mesmo
// padrão de `fluxo_pedido_json`/`comportamento_json`: estrutura validada por
// schema, com default que reproduz o comportamento anterior à feature (nada
// muda visualmente até a empresa mexer de propósito).
//
// O schema é `.strict()` de propósito: um campo novo digitado à mão no banco
// vira erro de parse, nunca é ignorado em silêncio.

import { z } from "zod";

/** Conjunto pequeno e deliberado de fontes. Só famílias de sistema — carregar
 * fonte de rede numa página pública custa tempo de carregamento no celular do
 * cliente e um dependência externa a mais; três opções distintas o bastante
 * pra dar cara diferente sem isso. */
export const FONTES_PUBLICO = ["padrao", "serifada", "moderna"] as const;
export type FontePublico = (typeof FONTES_PUBLICO)[number];

/** Como os produtos do cardápio são organizados na página pública. */
export const LAYOUTS_PUBLICO = ["lista", "grade"] as const;
export type LayoutPublico = (typeof LAYOUTS_PUBLICO)[number];

export const PublicoConfigSchema = z
  .object({
    /** Cor de destaque em hex (#rrggbb). `null` = usa a cor de marca padrão
     * da plataforma (`--primary` do painel). */
    cor_primaria: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
    fonte: z.enum(FONTES_PUBLICO),
    layout: z.enum(LAYOUTS_PUBLICO),
  })
  .strict();

export type PublicoConfig = z.infer<typeof PublicoConfigSchema>;

/** Reproduz a aparência anterior à feature: cor padrão da plataforma, fonte
 * padrão e produtos em lista. Usado quando a empresa nunca salvou nada. */
export const PUBLICO_CONFIG_PADRAO: PublicoConfig = {
  cor_primaria: null,
  fonte: "padrao",
  layout: "lista",
};
