/**
 * Consulta de Pedido no ERP Externo — plugin de exemplo para o Novus CRM.
 *
 * Implementa o protocolo de plugins diretamente (postMessage + MessageChannel),
 * sem depender de nenhuma biblioteca do Novus CRM. O objetivo é deixar visível
 * exatamente o que trafega entre o plugin e o host — veja o README para a
 * explicação de cada peça.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Camada de protocolo (genérica — não muda entre plugins diferentes)
  // ---------------------------------------------------------------------

  // Canal persistente: fica aberto durante toda a vida do plugin e é por onde
  // o host manda eventos ("callback", "close_custom_modal") de volta pra cá.
  const canalPersistente = new MessageChannel();
  const callbacksRegistrados = {};
  let proximoId = 0;

  function gerarCallbackId(prefixo) {
    proximoId += 1;
    return `${prefixo}-${proximoId}`;
  }

  canalPersistente.port1.onmessage = (evento) => {
    const mensagem = evento.data;
    if (!mensagem || mensagem.command !== "callback") return;
    const callback = callbacksRegistrados[mensagem.callbackId];
    if (typeof callback === "function") callback(mensagem.payload);
  };

  /** Registra uma função local e devolve o EventDef que vai no `initialize`. */
  function registrarEvento(nomeCanonico, handler) {
    const callbackId = gerarCallbackId(nomeCanonico);
    callbacksRegistrados[callbackId] = handler;
    return { callbackId };
  }

  /**
   * Envia um comando ao host e espera a resposta. Cada chamada abre um
   * MessageChannel próprio — só o `initialize` usa o canal persistente.
   */
  function enviarComando(command, args) {
    return new Promise((resolve, reject) => {
      const canal = new MessageChannel();
      canal.port1.onmessage = (evento) => {
        const resposta = evento.data || {};
        if (resposta.error) {
          reject(new Error(resposta.error));
          return;
        }
        resolve(resposta.data !== undefined ? resposta.data : resposta.payload);
      };
      window.parent.postMessage({ command, args }, "*", [canal.port2]);
    });
  }

  /** Registra o plugin no host. Precisa ser a primeira mensagem enviada. */
  function inicializar(idPlugin, registry) {
    window.parent.postMessage(
      { command: "initialize", args: registry, id: idPlugin },
      "*",
      [canalPersistente.port2],
    );
  }

  // ---------------------------------------------------------------------
  // Lógica do plugin (a parte que muda pra cada plugin real)
  // ---------------------------------------------------------------------

  const elEstado = document.getElementById("estado");
  const elResultado = document.getElementById("resultado");

  function mostrarEstado(texto) {
    elEstado.textContent = texto;
    elEstado.hidden = !texto;
    elResultado.hidden = true;
  }

  function mostrarPedido(pedido) {
    elResultado.querySelector('[data-campo="numero"]').textContent =
      pedido.numero ?? "—";
    elResultado.querySelector('[data-campo="status"]').textContent =
      pedido.status ?? "—";
    elResultado.querySelector('[data-campo="valor"]').textContent =
      pedido.valorFormatado ?? "—";
    elResultado.hidden = false;
    elEstado.hidden = true;
  }

  async function aoAbrirAtendimento(atendimento) {
    const telefone = atendimento && atendimento.contato && atendimento.contato.numero;
    if (!telefone) {
      mostrarEstado("Este contato não tem telefone cadastrado.");
      return;
    }

    mostrarEstado("Consultando pedido…");

    try {
      // O plugin nunca vê a chave do ERP: manda só o NOME do segredo em
      // `secretRefs`, e o host resolve o valor real do lado do servidor
      // antes de chamar o ERP. Ver README, seção "Segurança".
      const pedido = await enviarComando("apiRequest", {
        host: "meuerp",
        method: "GET",
        endpoint: "pedidos/por-telefone",
        query: { telefone },
        secretRefs: {
          "X-Api-Key": { secret: "meuErpApiKey", in: "header" },
        },
      });

      if (!pedido) {
        mostrarEstado("Nenhum pedido encontrado para este contato.");
        return;
      }

      mostrarPedido(pedido);
    } catch (erro) {
      mostrarEstado("Não foi possível consultar o pedido agora.");
      console.error("[consulta-pedido-erp]", erro);
    }
  }

  function aoFecharAtendimento() {
    mostrarEstado("Abra um atendimento para consultar o pedido do contato.");
  }

  mostrarEstado("Abra um atendimento para consultar o pedido do contato.");

  inicializar("consulta-pedido-erp", {
    widgetbar: [
      {
        id: "consulta-pedido",
        label: "Pedido do contato",
      },
    ],
    events: {
      aoAbrirAtendimento: registrarEvento("aoAbrirAtendimento", aoAbrirAtendimento),
      aoFocarAtendimento: registrarEvento("aoFocarAtendimento", aoAbrirAtendimento),
      aoFecharAtendimento: registrarEvento("aoFecharAtendimento", aoFecharAtendimento),
    },
  });
})();
