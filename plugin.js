/**
 * Vendas do contato no C-Plus 5 — plugin de exemplo para o Novus CRM.
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

  /**
   * Hosts do proxy. O plugin escolhe o destino pelo NOME — nunca pela URL —
   * e o servidor do Novus CRM resolve endereço, chave e ambiente.
   *
   * - "publica": API pública do próprio Novus CRM. O proxy já injeta a chave
   *   (variável `chaveApiPublica`) e o ambiente da sessão, então esta chamada
   *   não precisa de `secretRefs`.
   * - "cplus5": API pública do ERP C-Plus 5. Precisa ser liberada pelo suporte
   *   do Novus CRM e usa as duas variáveis abaixo. Ver README.
   */
  const HOST_NOVUS = "publica";
  const HOST_ERP = "cplus5";

  /**
   * Referências de segredo do C-Plus 5. O plugin manda só o NOME da variável
   * e onde ela entra; o valor é resolvido no servidor e injetado no cabeçalho
   * antes da chamada. Nunca chega ao navegador do atendente.
   */
  const SEGREDOS_DO_ERP = {
    "X-Authorization": { secret: "cplus.chaveapi", in: "header" },
    "X-Ambiente": { secret: "cplus.ambiente", in: "header" },
  };

  const POR_PAGINA = 10;

  /**
   * Ícone do botão na barra lateral direita.
   *
   * Vai embutido como data URI, não como arquivo. O Novus CRM monta uma
   * `<img>` com este valor dentro do DOM dele, e uma imagem que não carrega
   * deixa o botão invisível (a `<img>` do host é `alt=""` e `aria-hidden`) —
   * o item continua clicável, mas o atendente não vê nada. Data URI não tem
   * segunda requisição para falhar.
   *
   * Se preferir servir um arquivo, use URL absoluta:
   *
   *     const ICONE = new URL("icone.svg", location.href).href;
   *
   * Caminho relativo não funciona: quem resolve a URL é a página do Novus
   * CRM, então "icone.svg" apontaria para o domínio do CRM, não para o seu.
   *
   * Sem esta chave o host desenha uma peça de quebra-cabeça genérica.
   *
   * Glifo: Phosphor Icons (MIT), regular/receipt. O bloco azul existe porque
   * uma imagem não herda a cor do texto da barra: com fundo próprio, o ícone
   * tem contraste igual no tema claro e no escuro.
   */
  const ICONE =
    "data:image/svg+xml," +
    encodeURIComponent(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">',
        '<rect width="256" height="256" rx="56" fill="#0030FF"/>',
        '<g transform="translate(48 48) scale(0.625)" fill="#FFFFFF">',
        '<path d="M72,104a8,8,0,0,1,8-8h96a8,8,0,0,1,0,16H80A8,8,0,0,1,72,104Zm8,40h96a8,8,0,0,0,0-16H80a8,8,0,0,0,0,16ZM232,56V208a8,8,0,0,1-11.58,7.15L192,200.94l-28.42,14.21a8,8,0,0,1-7.16,0L128,200.94,99.58,215.15a8,8,0,0,1-7.16,0L64,200.94,35.58,215.15A8,8,0,0,1,24,208V56A16,16,0,0,1,40,40H216A16,16,0,0,1,232,56Zm-16,0H40V195.06l20.42-10.22a8,8,0,0,1,7.16,0L96,199.06l28.42-14.22a8,8,0,0,1,7.16,0L160,199.06l28.42-14.22a8,8,0,0,1,7.16,0L216,195.06Z"/>',
        "</g></svg>",
      ].join(""),
    );

  /** StatusDoMovimento da API do C-Plus 5 → rótulo e cor do rótulo. */
  const STATUS = {
    1: { rotulo: "Não realizada", cor: "var(--ambar)" },
    2: { rotulo: "Realizada", cor: "var(--verde)" },
    3: { rotulo: "Cancelada", cor: "var(--vermelho)" },
    4: { rotulo: "Estornada", cor: "var(--cinza)" },
    99: { rotulo: "Liberada", cor: "var(--azul)" },
  };

  const dinheiro = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
  const dataCurta = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  // Estado do painel. `idPessoaNoErp` é o que amarra o contato do atendimento
  // às vendas: sem ele não há o que listar.
  const estado = {
    idContato: null,
    idPessoaNoErp: null,
    pagina: 1,
    totalPaginas: 1,
    busca: "",
  };

  const secoes = {};
  const campos = {};
  document.querySelectorAll("[data-secao]").forEach((el) => {
    secoes[el.dataset.secao] = el;
  });
  document.querySelectorAll("[data-campo]").forEach((el) => {
    campos[el.dataset.campo] = el;
  });
  const modeloDeVenda = document.querySelector('[data-modelo="venda"]');
  const botaoAnterior = document.querySelector('[data-acao="anterior"]');
  const botaoProxima = document.querySelector('[data-acao="proxima"]');
  const botaoRepetir = document.querySelector('[data-acao="repetir"]');

  // --- Renderização -----------------------------------------------------

  /** Visibilidade das partes ligadas à identificação do cliente. */
  function exibir(nome, visivel) {
    secoes[nome].hidden = !visivel;
  }

  /**
   * Máquina de estado do corpo do painel: "carregando", "lista" ou "aviso".
   *
   * Uma função só decide o que aparece. Antes cada estado precisava lembrar
   * de esconder os outros, e bastava esquecer um deles para o painel mostrar
   * duas coisas ao mesmo tempo — uma barra de contagem órfã em cima de uma
   * mensagem de erro, por exemplo.
   */
  function mostrarVista(vista) {
    secoes.esqueleto.hidden = vista !== "carregando";
    secoes.aviso.hidden = vista !== "aviso";
    secoes.lista.hidden = vista !== "lista";
    secoes.contexto.hidden = vista !== "lista";
    secoes.paginacao.hidden = vista !== "lista" || estado.totalPaginas <= 1;
  }

  /**
   * O chip do código vira um bloco cinza enquanto a busca acontece. Um "…"
   * ali parece defeito; um bloco do tamanho certo lê como "está vindo".
   */
  function marcarCodigoCarregando() {
    campos.codigoPessoa.hidden = false;
    campos.codigoPessoa.textContent = "";
    campos.codigoPessoa.dataset.carregando = "";
  }

  function mostrarCodigo(codigo) {
    campos.codigoPessoa.hidden = false;
    delete campos.codigoPessoa.dataset.carregando;
    campos.codigoPessoa.textContent = codigo;
  }

  function mostrarAviso(titulo, texto, comRepetir) {
    campos.avisoTitulo.textContent = titulo;
    campos.avisoTexto.textContent = texto;
    botaoRepetir.hidden = !comRepetir;
    mostrarVista("aviso");
  }

  /**
   * "12 vendas, mais recentes primeiro" ou "3 vendas com produto cabo".
   *
   * Uma linha carrega a contagem e o filtro ativo. O atendente precisa dos
   * dois: quantos resultados existem e por que a lista encolheu.
   */
  function descreverContexto(total) {
    const filtro = filtroDaBusca(estado.busca);
    // "1 venda, mais recentes primeiro" não faz sentido: a nota de ordenação
    // só entra quando há mais de uma linha para ordenar.
    const sufixo = estado.busca || total > 1 ? filtro.descricao : "";
    campos.contexto.replaceChildren(
      Object.assign(document.createElement("strong"), {
        textContent: String(total),
      }),
      document.createTextNode(` ${total === 1 ? "venda" : "vendas"}${sufixo}`),
    );
  }

  function renderizarVendas(vendas, totalDeVendas) {
    const lista = secoes.lista;
    lista.replaceChildren();

    vendas.forEach((venda) => {
      const linha = modeloDeVenda.content.cloneNode(true);
      const status = STATUS[venda.Status] || {
        rotulo: "Sem status",
        cor: "var(--cinza)",
      };
      const rotuloStatus = linha.querySelector('[data-campo="status"]');

      rotuloStatus.style.setProperty("--cor-status", status.cor);
      rotuloStatus.textContent = status.rotulo;
      linha.querySelector('[data-campo="numero"]').textContent =
        venda.NumeroSaida != null ? `#${venda.NumeroSaida}` : "sem número";
      linha.querySelector('[data-campo="valor"]').textContent = dinheiro.format(
        venda.ValorTotal || 0,
      );
      linha.querySelector('[data-campo="data"]').textContent = venda.Data
        ? dataCurta.format(new Date(venda.Data))
        : "sem data";
      linha.querySelector('[data-campo="itens"]').textContent =
        resumirItens(venda.Itens);

      lista.appendChild(linha);
    });

    estado.totalPaginas = Math.max(1, Math.ceil(totalDeVendas / POR_PAGINA));

    descreverContexto(totalDeVendas);
    campos.posicao.textContent = `Página ${estado.pagina} de ${estado.totalPaginas}`;
    botaoAnterior.disabled = estado.pagina <= 1;
    botaoProxima.disabled = estado.pagina >= estado.totalPaginas;

    mostrarVista("lista");
  }

  /** "3 itens · Cabo HDMI 2m, Fonte 12V" — o suficiente pra reconhecer a venda. */
  function resumirItens(itens) {
    if (!Array.isArray(itens) || itens.length === 0) return "Sem itens";
    const nomes = itens
      .map((item) => item.NomeProduto)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    const contagem = `${itens.length} ${itens.length === 1 ? "item" : "itens"}`;
    return nomes ? `${contagem} · ${nomes}` : contagem;
  }

  // --- Chamadas de API --------------------------------------------------

  /**
   * Descobre o código da pessoa do contato ativo e o traduz para o id que o
   * C-Plus 5 usa nas vendas. São três saltos, e cada um pode faltar num
   * cadastro incompleto — por isso cada etapa tem seu próprio aviso:
   *
   *   contato do atendimento → IdPessoa (Novus) → Codigo (Novus) → Id (C-Plus 5)
   */
  async function resolverPessoaNoErp(idContato) {
    const contato = await enviarComando("apiRequest", {
      host: HOST_NOVUS,
      method: "GET",
      endpoint: `v1/contatodechat/${idContato}`,
    });

    if (!contato || !contato.IdPessoa) {
      return { erro: "sem-pessoa" };
    }

    const pessoa = await enviarComando("apiRequest", {
      host: HOST_NOVUS,
      method: "GET",
      endpoint: `v1/pessoas/${contato.IdPessoa}`,
    });

    const codigo = pessoa && pessoa.Codigo;
    if (!codigo) {
      return { erro: "sem-codigo" };
    }

    // `Codigo` é o campo que os dois sistemas compartilham. No C-Plus 5 as
    // vendas são filtradas por `IdPessoa` (uuid), então o código vira id aqui.
    const clientes = await enviarComando("apiRequest", {
      host: HOST_ERP,
      method: "GET",
      endpoint: "v1/Clientes",
      query: { Codigo: codigo, limite: 1 },
      secretRefs: SEGREDOS_DO_ERP,
    });

    const cliente = clientes && clientes.Value && clientes.Value[0];
    if (!cliente) {
      return { erro: "sem-cliente", codigo };
    }

    return { id: cliente.Id, codigo, nome: cliente.Nome };
  }

  /**
   * A busca do painel é um campo só, mas o C-Plus 5 tem um filtro para cada
   * coisa. Só dígitos vira busca por número da venda; qualquer outra coisa
   * vira busca por nome de produto.
   */
  function filtroDaBusca(termo) {
    if (!termo) {
      return { query: {}, descricao: ", mais recentes primeiro" };
    }
    if (/^\d+$/.test(termo)) {
      return {
        query: { NumeroDaVendaAproximado: termo },
        descricao: ` com número ${termo}`,
      };
    }
    return {
      query: { NomeDoProdutoAproximado: termo },
      descricao: ` com produto ${termo}`,
    };
  }

  /**
   * Traduz o erro técnico do proxy para um recado que o atendente entenda.
   *
   * As mensagens do proxy são poucas e previsíveis, e cada uma aponta para um
   * passo específico da configuração (ver README). Mapear uma a uma custa
   * pouco e evita o clássico "algo deu errado", que não ajuda ninguém: quem
   * lê o painel é o atendente, que não mexe em configuração e precisa saber
   * se deve chamar o administrador ou só tentar de novo.
   *
   * `repetir` liga o botão "Tentar de novo" — só faz sentido em falha
   * passageira. Erro de configuração não melhora repetindo.
   */
  function explicarErro(erro) {
    const mensagem = (erro && erro.message) || "";

    if (mensagem === "Host not allowed") {
      return {
        titulo: "C-Plus 5 não conectado",
        texto:
          "A integração com o C-Plus 5 ainda não foi habilitada nesta conta. Peça ao suporte do Novus CRM para liberá-la.",
        repetir: false,
      };
    }

    if (mensagem === "Endpoint not allowed" || mensagem === "Method not allowed") {
      return {
        titulo: "Consulta não autorizada",
        texto:
          "A integração existe, mas esta consulta ainda não foi liberada. O suporte do Novus CRM resolve isso.",
        repetir: false,
      };
    }

    const segredoFaltando = mensagem.match(/^Secret not found: (.+)$/);
    if (segredoFaltando) {
      return {
        titulo: "Configuração incompleta",
        texto: `Falta cadastrar a variável "${segredoFaltando[1]}" nas configurações da conta.`,
        repetir: false,
      };
    }

    if (mensagem === "Unauthorized") {
      return {
        titulo: "Sessão expirada",
        texto: "Atualize a página do Novus CRM para entrar novamente.",
        repetir: false,
      };
    }

    // Quando o ERP responde com erro, o proxy repassa o status dele.
    if (/^proxy 40[13]$/.test(mensagem)) {
      return {
        titulo: "Acesso recusado pelo C-Plus 5",
        texto:
          "O C-Plus 5 não aceitou as credenciais cadastradas. Peça ao administrador para conferir a chave de API e o ambiente.",
        repetir: false,
      };
    }

    return {
      titulo: "C-Plus 5 indisponível",
      texto:
        "Não conseguimos falar com o C-Plus 5 agora. Tente de novo em alguns instantes.",
      repetir: true,
    };
  }

  async function carregarVendas() {
    if (!estado.idPessoaNoErp) return;

    const filtro = filtroDaBusca(estado.busca);

    mostrarVista("carregando");

    try {
      const resposta = await enviarComando("apiRequest", {
        host: HOST_ERP,
        method: "GET",
        endpoint: "v1/Vendas",
        query: Object.assign(
          {
            IdPessoa: estado.idPessoaNoErp,
            pagina: estado.pagina,
            limite: POR_PAGINA,
            ordenacao: "Data DESC",
          },
          filtro.query,
        ),
        secretRefs: SEGREDOS_DO_ERP,
      });

      const vendas = (resposta && resposta.Value) || [];
      const total = (resposta && resposta.Paging && resposta.Paging.TotalCount) || 0;

      if (vendas.length === 0) {
        mostrarAviso(
          estado.busca ? "Nada encontrado" : "Nenhuma venda",
          estado.busca
            ? "Nenhuma venda deste contato bate com a busca."
            : "Este contato ainda não tem vendas registradas no C-Plus 5.",
          false,
        );
        return;
      }

      renderizarVendas(vendas, total);
    } catch (erro) {
      const aviso = explicarErro(erro);
      mostrarAviso(aviso.titulo, aviso.texto, aviso.repetir);
      console.error("[vendas-cplus5]", erro);
    }
  }

  // --- Eventos de atendimento -------------------------------------------

  async function aoAbrirAtendimento(atendimento) {
    const contato = (atendimento && atendimento.contato) || {};
    if (!contato.id) {
      aoFecharAtendimento();
      return;
    }

    // O host reemite o atendimento em foco a cada abrir/focar. Sem esta guarda
    // o painel recarregaria tudo e perderia a página e a busca do atendente.
    if (contato.id === estado.idContato) return;

    estado.idContato = contato.id;
    estado.idPessoaNoErp = null;
    estado.pagina = 1;
    estado.busca = "";
    campos.busca.value = "";

    campos.nomeContato.textContent = contato.nome || "Contato";
    marcarCodigoCarregando();
    exibir("contato", true);
    exibir("busca", false);
    mostrarVista("carregando");

    try {
      const pessoa = await resolverPessoaNoErp(contato.id);

      if (pessoa.erro === "sem-pessoa") {
        campos.codigoPessoa.hidden = true;
        mostrarAviso(
          "Contato sem cadastro",
          "Este contato não está vinculado a uma pessoa no Novus CRM.",
          false,
        );
        return;
      }

      if (pessoa.erro === "sem-codigo") {
        campos.codigoPessoa.hidden = true;
        mostrarAviso(
          "Pessoa sem código",
          "A pessoa deste contato não tem código de cadastro — é ele que liga o Novus CRM ao C-Plus 5.",
          false,
        );
        return;
      }

      if (pessoa.erro === "sem-cliente") {
        mostrarCodigo(pessoa.codigo);
        mostrarAviso(
          "Cliente não encontrado",
          `Nenhum cliente com o código ${pessoa.codigo} existe no C-Plus 5.`,
          false,
        );
        return;
      }

      estado.idPessoaNoErp = pessoa.id;
      mostrarCodigo(pessoa.codigo);
      if (pessoa.nome) campos.nomeContato.textContent = pessoa.nome;
      exibir("busca", true);

      await carregarVendas();
    } catch (erro) {
      const aviso = explicarErro(erro);
      mostrarAviso(aviso.titulo, aviso.texto, aviso.repetir);
      console.error("[vendas-cplus5]", erro);
    }
  }

  function aoFecharAtendimento() {
    estado.idContato = null;
    estado.idPessoaNoErp = null;
    exibir("contato", false);
    exibir("busca", false);
    mostrarAviso(
      "Nenhum atendimento aberto",
      "Abra um atendimento para ver as vendas do contato no C-Plus 5.",
      false,
    );
  }

  // --- Interações do painel ---------------------------------------------

  let debounce;
  campos.busca.addEventListener("input", (evento) => {
    const termo = evento.target.value.trim();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (termo === estado.busca) return;
      estado.busca = termo;
      estado.pagina = 1;
      carregarVendas();
    }, 350);
  });

  botaoAnterior.addEventListener("click", () => {
    if (estado.pagina <= 1) return;
    estado.pagina -= 1;
    carregarVendas();
  });

  botaoProxima.addEventListener("click", () => {
    if (estado.pagina >= estado.totalPaginas) return;
    estado.pagina += 1;
    carregarVendas();
  });

  botaoRepetir.addEventListener("click", () => {
    if (estado.idPessoaNoErp) {
      carregarVendas();
      return;
    }
    // Ainda nem chegamos a resolver a pessoa: refaz desde o começo.
    const idContato = estado.idContato;
    estado.idContato = null;
    aoAbrirAtendimento({ contato: { id: idContato } });
  });

  // --- Registro ---------------------------------------------------------

  aoFecharAtendimento();

  inicializar("vendas-cplus5", {
    // Item sem `callback`: o clique faz o host abrir o painel do próprio
    // plugin num drawer de 380px na barra lateral direita. Com `callback`,
    // o clique voltaria pra cá e o drawer não abriria sozinho.
    widgetbar: [
      {
        id: "vendas-cplus5",
        text: "Vendas no C-Plus 5",
        icon_url: ICONE,
      },
    ],
    events: {
      // O host retém o último atendimento focado e reemite para plugins que
      // terminam de carregar depois — é assim que o painel já abre preenchido.
      aoAbrirAtendimento: registrarEvento("aoAbrirAtendimento", aoAbrirAtendimento),
      aoFocarAtendimento: registrarEvento("aoFocarAtendimento", aoAbrirAtendimento),
      aoFecharAtendimento: registrarEvento("aoFecharAtendimento", aoFecharAtendimento),
    },
  });
})();
