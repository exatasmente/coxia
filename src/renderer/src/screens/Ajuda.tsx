import { type ReactNode, useEffect } from 'react';
import type { Screen } from '../App';
import { BackIcon } from './icons';

// F1 opens the help from any screen and closes it when it is already open.
export function useHelpShortcut(current: Screen['name'], go: (s: Screen) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F1' || e.repeat) return;
      e.preventDefault();
      go({ name: current === 'help' ? 'today' : 'help' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, go]);
}

const Key = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>;

function Item({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div style={{ fontWeight: 600 }}>{term}</div>
      <div className="small" style={{ lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}

function Block({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2>
        {intro && <p className="small muted" style={{ marginTop: 4 }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function Ajuda({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 980, gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Ajuda</h1>
          </div>
          <span className="small muted">Aperte <Key>F1</Key> em qualquer tela para abrir ou fechar.</span>
        </header>

        <Block title="Atalhos e voz" intro="Valem nas telas com microfone: call, desbloqueio, gate, passagem para o QA, retorno do QA, conflito e retro.">
          <Item term={<Key>Espaço</Key>}>
            Começa a gravar. Apertando de novo, a fala é enviada. Não vale com o foco num campo de texto, botão, lista ou link: aí o espaço faz o que o controle faz.
          </Item>
          <Item term="Envio pelo silêncio">
            Com a opção ligada, depois que você começa a falar, uma pausa longa envia a fala sozinha. Cada fala tem no máximo 30 segundos. A pausa padrão é de 1200 ms e muda em Configurações › Voz.
          </Item>
          <Item term="Digitar">
            Nas telas de conversa há um campo de texto (“Ou digite…”) para escrever em vez de falar: escreva e aperte <Key>Enter</Key>.
          </Item>
          <Item term={<><Key>Tab</Key> e <Key>Shift</Key>+<Key>Tab</Key></>}>
            Passam de controle em controle; <Key>Enter</Key> ou <Key>Espaço</Key> ativa o botão em foco. O contorno do foco aparece só no teclado.
          </Item>
          <Item term="Voz dos agentes">
            O botão “Voz ligada/desligada” no alto de Hoje (e Configurações › Voz) liga ou desliga a fala dos agentes. Desligada, tudo continua na tela e nada vai para o Edge.
          </Item>
        </Block>

        <Block title="Comandos de voz na call" intro="Na pré-daily, o app lê a sua fala (sem acento e sem maiúscula) antes de mandá-la ao agente. Qualquer outra frase vai para o agente da atividade.">
          <Item term="“próximo”, “pula”, “passa”, “segue”">
            Passa para o próximo agente. Na última atividade, fecha a pauta. Precisa estar no começo da frase.
          </Item>
          <Item term="“aprofunda”, “desbloqueio”">
            Abre o Desbloqueio da atividade atual: uma conversa a fundo com o agente dela. Em qualquer parte da frase.
          </Item>
          <Item term="“encerra”, “termina”">
            Encerra a call e mostra o fim da pauta, de onde você gera a ata. Em qualquer parte da frase.
          </Item>
        </Block>

        <Block title="O que cada cerimônia faz">
          <Item term="Pré-daily">
            Lê o GitLab pelo daily-report e monta um agente por atividade, bloqueadas primeiro. Na call, o moderador abre e cada agente fala a sua vez (cerca de 30 segundos): o que andou, o próximo passo, o bloqueio e, se houver, uma pergunta para você. Suas respostas viram decisões e efeitos, que vão para a ata.
          </Item>
          <Item term="Desbloqueio">
            Conversa a fundo sobre uma atividade travada. O agente lê spec, GitLab e playbook, e quando há contexto você pede de 2 a 3 saídas, cada uma com a sua consequência.
          </Item>
          <Item term="Passagem para o QA">
            O agente explica ao QA o que mudou e o que testar. Saem o checklist e o texto do aviso para o Teams.
          </Item>
          <Item term="Retro">
            Semanal. Junta os últimos 7 dias (reprovações, bloqueios, conflitos, quizzes errados e retrabalho) e conversa com o moderador sobre o que melhorar.
          </Item>
          <Item term="Gate">
            O agente lê o artefato da fase (Investigation, RFC, Spec Funcional, Findings ou Plan), faz o resumo do gate e até 3 perguntas de consequência. A aprovação continua sendo a sua frase no chat do Claude Code.
          </Item>
          <Item term="Retorno do QA, Discussões, GitLab">
            Retorno do QA explica uma atividade que voltou do teste. Discussões percorre as discussões abertas de uma MR. GitLab monta propostas (label, reviewer e afins) para você confirmar em Ações.
          </Item>
          <Item term="Radar">
            Só lê: cruza os arquivos das suas MRs abertas, de atividades diferentes, e avisa de colisão.
          </Item>
        </Block>

        <Block title="O que o app nunca faz sozinho">
          <Item term="Escrever no GitLab">
            Nunca por conta própria. Tudo que escreve (comentário, label, reviewer, merge da main numa branch e push) vira uma ação na tela Ações e só roda depois do seu “Seguir” e de uma confirmação. O push é sem force-push.
          </Item>
          <Item term="Publicar no Teams">
            Nunca. O texto é gerado e você copia e cola.
          </Item>
          <Item term="Executar efeitos da call">
            A fila de efeitos não roda nada: cada item vai para o Claude Code, onde espera o seu “sim”.
          </Item>
          <Item term="Os agentes">
            Só leem (arquivos, skills do playbook, GitLab). Editar arquivos, acessar a web, ler arquivos de segredo e escrever no GitLab ficam sempre bloqueados, seja qual for a configuração.
          </Item>
          <Item term="Escritas locais, com o seu clique">
            “Gravar ata e decisões” grava a ata do dia e leva só as decisões marcadas para o Registro do Plan ou para a nota do daily-report. “Gravar no .specs” cria o QA_CHECKLIST.md e “Inserir no artefato” põe o diagrama no documento do gate; os dois pedem confirmação.
          </Item>
        </Block>

        <Block title="Onde ficam os dados" intro="Tudo é arquivo local; nada vai para um servidor próprio.">
          <Item term={<span className="mono">~/.local/share/cerimonias/</span>}>
            Ata do dia (<span className="mono">AAAA-MM-DD-pre-daily.md</span>), <span className="mono">historico/</span> (cada cerimônia), <span className="mono">gates/</span>, <span className="mono">qa/</span>, <span className="mono">retros/</span>, <span className="mono">atividade/</span>, <span className="mono">config.json</span> (Configurações), <span className="mono">acoes.json</span> (Ações), <span className="mono">custo.json</span>, <span className="mono">radar.json</span> e <span className="mono">status.json</span>.
          </Item>
          <Item term={<span className="mono">~/projects/sz-playbook/.specs/</span>}>
            Specs que o app lê e, nas escritas acima, onde grava o Registro do Plan, o QA_CHECKLIST.md e o diagrama do gate.
          </Item>
          <Item term="Tema">
            Configurações › Aparência: sistema, claro ou escuro. A call e os painéis de destaque ficam escuros nos dois.
          </Item>
        </Block>
      </div>
    </div>
  );
}
