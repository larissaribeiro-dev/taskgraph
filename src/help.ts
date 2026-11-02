export const VERSION = "0.1.0";

export const HELP = `taskgraph ${VERSION} - lista de tarefas com dependências

Uso: taskgraph <comando> [argumentos] [opções]

Comandos:
  add <título>          cria uma tarefa
  list                  lista as pendentes (é o padrão quando não há comando)
  done <id>             conclui uma tarefa
  undo <id>             reabre uma tarefa concluída
  rm <id>               remove uma tarefa
  edit <id>             altera título, prioridade, prazo ou tags
  dep <id> <de-id>      faz <id> depender de <de-id>
  undep <id> <de-id>    remove essa dependência
  next [n]              as n tarefas mais urgentes que já dá para fazer (padrão 3)
  plan                  ordem completa para terminar tudo
  graph                 grafo de dependências em Mermaid
  stats                 resumo numérico

Opções (cada uma vale só para alguns comandos):
  -p, --priority <alta|media|baixa>   add, edit
  -d, --due <data>                    add, edit   (AAAA-MM-DD, hoje, amanha, +Nd)
  -t, --tag <a,b>                     add, edit, list
      --deps <1,2>                    add
      --title <texto>                 edit
  -a, --all                           list
  -f, --force                         done
  -h, --help                          mostra esta ajuda
  -v, --version                       mostra a versão

Variável de ambiente:
  TASKGRAPH_FILE   caminho do arquivo de dados (padrão: ~/.taskgraph.json)
`;
