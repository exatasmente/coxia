# The documentation site / O site de documentação

[Português](#português) | [English](#english)

---

## Português

O repositório publica um site de documentação a partir da pasta [`site/`](../site/README.md): uma abertura, o guia,
a documentação de referência que já está em [`docs/`](README.md), os casos de uso e o blog. Ele é escrito e
mantido por um agente do time pelo ciclo normal de documentação, como qualquer outra mudança do repositório.

### De onde vem cada página

| Seção | De onde vem |
|---|---|
| Abertura, guia, casos de uso | Páginas escritas à mão ou por um agente, em `site/`, nas duas línguas |
| Referência | Os documentos de `docs/`, lidos onde estão: cada documento vira uma página, com endereço derivado do próprio caminho |
| Histórico | O `CHANGELOG.md`, montado na hora de construir; não existe uma segunda cópia |
| Blog | Um texto por versão **estável**, escrito da seção daquela versão no `CHANGELOG.md` |

Nada de `docs/` é copiado nem movido: a pasta continua sendo a fonte que os agentes do aplicativo leem em tempo de
execução. A documentação em que o repositório escreve uma língua só aparece naquela língua — a checagem de línguas
respeita isso.

### Construir, prévia e checagem

```bash
npm run docs:dev      # prévia local
npm run docs:build    # constrói em site/.vitepress/dist
npm run docs:check    # links e línguas, sobre o site construído
```

A checagem do site roda na etapa `check` do fluxo de verificação (`.github/workflows/ci.yml`), junto dos outros
portões: um link que aponta para uma página que não existe e uma página que perdeu uma das duas línguas reprovam o
pedido de merge. A pasta gerada e a construção não são versionadas.

### Publicação

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) constrói o site a cada push na ramificação padrão e
o publica na fonte de GitHub Actions. **A pessoa liga o Pages uma vez**, na configuração do repositório, no host;
nada no aplicativo nem neste repositório escreve essa configuração, e nenhum arquivo da árvore traz o endereço
publicado — a construção o recebe do próprio fluxo.

### Imagens

Até as capturas chegarem (o pedido que as tira de um espaço de trabalho semeado com dados fictícios, refeitas a cada
versão), cada lugar que pede imagem mostra texto e um espaço reservado. O site nunca usa uma captura com dado real de
uma pessoa, de uma empresa ou de um host.

---

## English

The repository publishes a documentation site from the [`site/`](../site/README.md) folder: a landing page, the
guide, the reference documentation already in [`docs/`](README.md), the use cases and the blog. It is written and
maintained by an agent of the team through the normal documentation cycle, like any other change of the repository.

### Where each page comes from

| Section | Where it comes from |
|---|---|
| Landing, guide, use cases | Pages written by hand or by an agent, in `site/`, in both languages |
| Reference | The documents of `docs/`, read where they are: each document becomes a page, with an address derived from its own path |
| History | `CHANGELOG.md`, assembled as the site is built; no second copy exists |
| Blog | One post per **stable** version, written from that version's section of `CHANGELOG.md` |

Nothing in `docs/` is copied or moved: the folder stays the source the app's agents read at run time. A document the
repository writes in one language only appears in that language — the language check respects that.

### Building, preview and checks

```bash
npm run docs:dev      # the local preview
npm run docs:build    # build into site/.vitepress/dist
npm run docs:check    # links and languages, over the built site
```

The site's checks run in the `check` stage of the verification workflow (`.github/workflows/ci.yml`), next to the
other gates: a link that points at a page the site does not have, and a page that lost one of its two languages,
fail the pull request. The generated folder and the build are not versioned.

### Publishing

[`.github/workflows/pages.yml`](../.github/workflows/pages.yml) builds the site on every push to the default branch
and publishes it through the GitHub Actions source. **The person turns Pages on once**, in the repository settings on
the host; nothing in the app or in this repository writes that setting, and no file of the tree carries the published
address — the build receives it from the workflow itself.

### Images

Until the screenshots land (the request that takes them from a seeded workspace holding fictitious data, refreshed
with each release), every place that asks for an image shows text and a placeholder. The site never uses a capture
with real data of a person, a company or a host.
