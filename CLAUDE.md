# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este repositório

Plugin de exemplo de referência para o [Novus CRM](https://novuscrm.com.br), mantido pelo time do produto. Serve como material didático: mostra como construir um plugin completo usando só o protocolo público, sem nenhuma biblioteca interna do Novus CRM.

O exemplo atual — **"Vendas do contato no C-Plus 5"** — lista, num painel da barra lateral direita do atendimento, as vendas do contato ativo buscadas no ERP C-Plus 5. Paginado, com busca.

Consequências práticas para qualquer alteração aqui:

- **Zero build.** Não há `package.json`, bundler, linter ou suíte de testes. São três arquivos estáticos (`index.html`, `plugin.js`, `manifest-exemplo.json`). Não introduzir toolchain sem pedido explícito. A única dependência externa em runtime é a folha de estilo do Google Fonts (IBM Plex Sans/Mono), com pilha de fallback no CSS.
- **Clareza pedagógica vence esperteza.** O código é lido por desenvolvedores externos aprendendo o protocolo. Abstrair a camada de `postMessage` numa lib ou minificar derrota o propósito do repositório.
- **Código, comentários e documentação em português (pt-BR).** Identificadores incluídos (`enviarComando`, `aoAbrirAtendimento`, `carregarVendas`). Exceções, todas definidas por sistemas de terceiros: as chaves do protocolo do host (`command`, `args`, `callbackId`, `initialize`, `apiRequest`, `secretRefs`, `widgetbar`) e os campos das APIs consumidas, que vêm em PascalCase (`IdPessoa`, `NumeroSaida`, `ValorTotal`, `Paging.TotalCount`).
- **README e código andam juntos.** O `README.md` explica passo a passo o que `plugin.js` faz e documenta a configuração no Novus CRM. Mudou o comportamento ou o nome de uma variável, atualize o README na mesma alteração.

## Rodar localmente

Servir os arquivos estáticos e apontar a URL no cadastro do plugin (**Opções → Plugins** no Novus CRM):

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Não há build, testes ou lint para rodar. Para checar sintaxe: `node --check plugin.js`.

## Arquitetura

### Modelo de execução

O plugin é uma página web hospedada por você, carregada num **iframe** do Novus CRM. Ele conversa com o host por `postMessage` + `MessageChannel`. Não tem acesso ao banco do Novus CRM nem recebe token de autenticação — toda chamada de API (interna ou externa) passa pelo proxy do servidor do Novus CRM.

### Duas camadas em `plugin.js`

O arquivo é deliberadamente dividido, e a divisão é o ponto central do exemplo:

1. **Camada de protocolo** (topo) — `enviarComando`, `inicializar`, `registrarEvento` e o handler do canal persistente. Genérica, idêntica em qualquer plugin. Se mudar, deve continuar mudando por motivo de protocolo, não de feature.
2. **Lógica do plugin** (resto) — constantes de host/segredo, estado, renderização e handlers de atendimento. É a parte que um desenvolvedor troca pela dele.

### Os dois tipos de canal

Distinção fácil de errar ao editar:

- **Canal persistente** (`canalPersistente`): criado uma vez, sua `port2` vai junto com a mensagem `initialize`. É por onde o **host chama o plugin** — mensagens com `command: "callback"` e um `callbackId` que resolve em `callbacksRegistrados`. Fica aberto pela vida toda do plugin.
- **Canal efêmero por comando**: cada `enviarComando` abre um `MessageChannel` novo, envia a `port2` junto e resolve a Promise na primeira resposta. Padrão request/response.

`initialize` precisa ser a primeira mensagem enviada ao host, e é a única que usa o canal persistente.

### Eventos retidos

O host **retém** o último `aoAbrirAtendimento`/`aoFocarAtendimento` e reemite para plugins que inicializam depois. Como o iframe carrega assíncrono, esse é o caminho normal — o painel abre já preenchido sem precisar consultar o host.

Corolário: abrir e focar caem no mesmo handler, e o handler **ignora reemissão do mesmo contato** (`if (contato.id === estado.idContato) return`). Sem essa guarda, cada troca de foco recarrega a lista e o atendente perde página e busca. Não remover.

### Registry do `initialize`

O objeto passado ao `inicializar` declara o que o plugin expõe. Este exemplo usa só duas chaves:

- `widgetbar`: botão na barra lateral direita do atendimento. Item sem `callback` faz o host abrir o painel do próprio plugin.
- `events`: mapa de evento → `{ callbackId }` produzido por `registrarEvento`.

O protocolo completo cobre mais superfícies (botões no chat, navbar, settings, `openModal`) e mais comandos (`openModal`, `getInfoUser`, `getInfoChannels`) — todos **fora do escopo deste exemplo, de propósito**. Não adicionar sem pedido explícito: o README declara o recorte como uma escolha editorial.

## Os dois hosts de API

O plugin escolhe o destino pelo **nome**, nunca pela URL. Constantes no topo da lógica:

- `HOST_NOVUS = "publica"` — API pública do próprio Novus CRM (`api.novuscrm.com.br`). Já vem liberada, e o proxy injeta sozinho a chave (variável `chaveApiPublica`) e o ambiente da sessão. **Não mandar `secretRefs` nessas chamadas.**
- `HOST_ERP = "cplus5"` — API pública do C-Plus 5 (`api.cplus.com.br`). Precisa ser liberada pelo suporte e usa `secretRefs`.

### Cadeia de resolução do contato

O contato do atendimento e o cliente do ERP são entidades diferentes; o campo que os liga é o **código da pessoa**. São quatro chamadas, em `resolverPessoaNoErp` + `carregarVendas`:

```
contato.id (evento)
  → GET v1/contatodechat/{id}   (publica) → IdPessoa
  → GET v1/pessoas/{id}         (publica) → Codigo
  → GET v1/Clientes?Codigo=…    (cplus5)  → Id do cliente no ERP
  → GET v1/Vendas?IdPessoa=…    (cplus5)  → lista paginada
```

Cada salto tem seu próprio estado de aviso (`sem-pessoa`, `sem-codigo`, `sem-cliente`). Não colapsar num erro genérico: na prática quase todo problema de integração é cadastro incompleto, e o atendente precisa saber qual.

## Segredos: nunca no código do plugin

Padrão obrigatório em qualquer exemplo de chamada externa. O plugin manda o **nome** da variável e onde ela entra; o host resolve o valor no servidor:

```js
const SEGREDOS_DO_ERP = {
  "X-Authorization": { secret: "cplusChaveApi", in: "header" },
  "X-Ambiente": { secret: "cplusAmbiente", in: "header" },
};
```

Nunca escrever uma chave literal, nem sugerir que o plugin a leia de config própria. O ponto do exemplo é que o valor jamais chega ao navegador.

**Pegadinha documentada no README:** o proxy injeta a variável como o conteúdo inteiro do cabeçalho, sem montar nada em volta. Por isso o valor de `cplusChaveApi` precisa incluir o prefixo — `X-Chave-Api {chave}` — e não só a chave. Se alguém "consertar" isso removendo o prefixo, a API do C-Plus 5 passa a responder 401.

## Pré-requisitos do lado do servidor

O `apiRequest` para o C-Plus 5 **falha por padrão** até que o suporte do Novus CRM (a) libere o host `cplus5` (`https://api.cplus.com.br`, com `GET v1/Clientes` e `GET v1/Vendas`) e (b) as variáveis `cplusChaveApi` e `cplusAmbiente` existam na conta. Isso é comportamento esperado, não bug — o README diz isso explicitamente e a mensagem de erro não deve ser "consertada".

## Vendas, não orçamentos — e por quê

Restrição real da API, verificada no swagger publicado e no `OrcamentosController` do C-Plus 5: `GET /v1/Orcamentos` aceita só `pagina`, `limite` e `ordenacao`. **Não há filtro por pessoa.** Listar os orçamentos de um contato exigiria baixar todos os orçamentos da empresa e filtrar no navegador.

`GET /v1/Vendas` filtra por `IdPessoa`, `Numero`, período e nome de produto no servidor — por isso o exemplo usa vendas. Se alguém pedir "troca para orçamentos", isso só é viável depois que a API do C-Plus 5 ganhar o filtro; até lá, dizer isso em vez de implementar filtragem no cliente.

## Busca: um campo, dois filtros

`filtroDaBusca` roteia o termo digitado: só dígitos → `NumeroDaVendaAproximado`; qualquer outra coisa → `NomeDoProdutoAproximado`. O painel mostra qual filtro está ativo. Ao mexer aqui, manter a dica visível — sem ela o atendente não entende por que uma busca não retornou nada.

## Design

Design system do C-Plus 5: azul **#0030FF**, bordas levemente arredondadas (`--raio: 8px`, `--raio-mini: 5px`). Direção visual: utilitária e densa — hairlines no lugar de sombras, IBM Plex Sans/Mono, numerais tabulares nos valores e datas, espinha colorida por status em cada linha. Tema claro e escuro via `prefers-color-scheme`; todos os tokens ficam em `:root`. O painel vive num iframe estreito (~380–420px) mas também abre em página inteira, daí o `max-width` no container.

## Referências

- Protocolo completo: <https://help.novuscrm.com.br/pages/api/plugins.mdx>
- Swagger do C-Plus 5: <https://api.cplus.com.br/swagger/v1/swagger.json>
- `manifest-exemplo.json` não é lido por nada — documenta os campos da tela de cadastro do plugin.
