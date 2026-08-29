# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é este repositório

Plugin de exemplo de referência para o [Novus CRM](https://novuscrm.com.br), mantido pelo time do produto. Serve como material didático: mostra como construir um plugin completo usando só o protocolo público, sem nenhuma biblioteca interna do Novus CRM.

Consequências práticas para qualquer alteração aqui:

- **Zero dependências, zero build.** Não há `package.json`, bundler, linter ou suíte de testes. São três arquivos estáticos (`index.html`, `plugin.js`, `manifest-exemplo.json`). Não introduzir toolchain sem pedido explícito.
- **Clareza pedagógica vence esperteza.** O código é lido por desenvolvedores externos aprendendo o protocolo. Abstrair a camada de `postMessage` numa lib ou minificar derrota o propósito do repositório.
- **Código, comentários e documentação em português (pt-BR).** Identificadores incluídos (`enviarComando`, `aoAbrirAtendimento`, `mostrarEstado`). Exceção: as chaves do protocolo (`command`, `args`, `callbackId`, `initialize`, `apiRequest`, `secretRefs`, `widgetbar`) são definidas pelo host e ficam em inglês.
- **README e código andam juntos.** O `README.md` explica linha a linha o que `plugin.js` faz e referencia suas seções nos comentários do código. Mudou o comportamento, atualize o README na mesma alteração.

## Rodar localmente

Servir os arquivos estáticos e apontar a URL no cadastro do plugin (**Configurações > Plugins** no Novus CRM):

```bash
npx serve .
# ou
python3 -m http.server 8080
```

Não há build, testes ou lint para rodar.

## Arquitetura

### Modelo de execução

O plugin é uma página web hospedada por você, carregada num **iframe** do Novus CRM. Ele conversa com o host por `postMessage` + `MessageChannel`. Não tem acesso ao banco do Novus CRM nem recebe token de autenticação — toda chamada de API (interna ou externa) passa pelo proxy do servidor do Novus CRM.

### Duas camadas em `plugin.js`

O arquivo é deliberadamente dividido, e a divisão é o ponto central do exemplo:

1. **Camada de protocolo** (topo) — `enviarComando`, `inicializar`, `registrarEvento` e o handler do canal persistente. Genérica, idêntica em qualquer plugin. Se mudar, deve continuar mudando por motivo de protocolo, não de feature.
2. **Lógica do plugin** (resto) — manipulação do DOM e handlers de atendimento. É a parte que um desenvolvedor troca pela dele.

### Os dois tipos de canal

Distinção fácil de errar ao editar:

- **Canal persistente** (`canalPersistente`): criado uma vez, sua `port2` vai junto com a mensagem `initialize`. É por onde o **host chama o plugin** — mensagens com `command: "callback"` e um `callbackId` que resolve em `callbacksRegistrados`. Fica aberto pela vida toda do plugin.
- **Canal efêmero por comando**: cada `enviarComando` abre um `MessageChannel` novo, envia a `port2` junto e resolve a Promise na primeira resposta. Padrão request/response.

`initialize` precisa ser a primeira mensagem enviada ao host, e é a única que usa o canal persistente.

### Fluxo

```
plugin carrega no iframe
  └─ inicializar() → { command: "initialize", args: registry, id } + canalPersistente.port2
       └─ host dispara callbacks registrados conforme o usuário interage
            └─ enviarComando("apiRequest", {...}) → host resolve segredos e chama o ERP
                 └─ devolve só o corpo da resposta ao plugin
```

### Registry do `initialize`

O objeto passado ao `inicializar` declara o que o plugin expõe. Este exemplo usa só duas chaves:

- `widgetbar`: item na barra lateral direita do atendimento.
- `events`: mapa de evento → `{ callbackId }` produzido por `registrarEvento`.

O protocolo completo cobre mais superfícies (botões no chat, navbar, settings, `openModal`) e mais comandos (`openModal`, `getInfoUser`, `getInfoChannels`) — todos **fora do escopo deste exemplo, de propósito**. Não adicionar sem pedido explícito: o README declara o recorte como uma escolha editorial.

## Segredos: nunca no código do plugin

Padrão obrigatório em qualquer exemplo de chamada externa. O plugin manda o **nome** do segredo e onde ele entra; o host resolve o valor no servidor:

```js
secretRefs: {
  "X-Api-Key": { secret: "meuErpApiKey", in: "header" },
}
```

Nunca escrever uma chave literal, nem sugerir que o plugin a leia de config própria. O ponto do exemplo é que o valor jamais chega ao navegador.

## Pré-requisitos do lado do servidor

O `apiRequest` deste exemplo **falha por padrão** até que o suporte do Novus CRM (a) libere o host externo (`meuerp`) com endpoints e métodos permitidos e (b) cadastre o segredo `meuErpApiKey`. Isso é comportamento esperado, não bug — o README diz isso explicitamente e a mensagem de erro não deve ser "consertada".

## Referências

- Protocolo completo: <https://help.novuscrm.com.br/pages/api/plugins.mdx>
- `manifest-exemplo.json` não é lido por nada — documenta os campos da tela de cadastro do plugin.
