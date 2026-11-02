# Como o taskgraph funciona

Este documento percorre o projeto por dentro, na ordem em que as coisas acontecem, com um exemplo sendo processado em cada etapa. Serve de guia para ler o código e para estudar os conceitos por trás dele.

## 1. O modelo de dados

Tudo gira em torno de duas estruturas, em `src/types.ts`.

```ts
interface Task {
  id: number;
  title: string;
  done: boolean;
  priority: 1 | 2 | 3;
  due: string | null; // "AAAA-MM-DD"
  tags: string[];
  deps: number[]; // ids das tarefas que precisam vir antes
  createdAt: string;
  doneAt: string | null;
}

interface Db {
  version: 1;
  nextId: number; // só cresce, nunca reaproveita ids
  tasks: Task[];
}
```

O campo `deps` é o que transforma a lista em um grafo. Cada id dentro de `deps` é uma aresta que aponta da dependência para a tarefa que espera por ela. No exemplo do README, a tarefa 2 tem `deps: [1]`, o que desenha a aresta `1 -> 2`.

O `Db` inteiro vai para o disco como JSON. Não há banco de dados.

## 2. A vida de um comando

Vamos seguir `taskgraph done 1 --force` do terminal até o arquivo.

```
bin.ts        monta o contexto (arquivo, data de hoje, cores) e chama run()
   |
cli.ts        parseArgs lê opções e argumentos
   |           confere: comando existe? opção vale para ele? número de argumentos está certo?
   |
store.ts      trava o arquivo (.lock), lê o JSON e valida
   |
commands.ts   o handler `done` chama o serviço
   |
service.ts    aplica a regra de negócio (bloquear ou não, o que foi liberado)
   |
store.ts      valida de novo, grava de forma atômica e solta o cadeado
   |
bin.ts        define o código de saída
```

### 2.1 `cli.ts` e a tabela de comandos

Cada comando é um objeto em `COMMANDS` (arquivo `commands.ts`) que declara quatro coisas: o texto de uso, quantos argumentos aceita, quais opções aceita e se escreve nos dados.

```ts
["done", { usage: "done <id>", arity: [1, 1], options: ["force"], writes: true, run: done }]
```

Com isso o `cli.ts` não precisa saber nada sobre cada comando. Ele só confere a declaração: se alguém escreve `taskgraph done 1 --priority alta`, a opção `--priority` não está em `options`, e o programa avisa em vez de ignorar em silêncio.

A tabela é um `Map` e não um objeto comum por um motivo concreto. Em um objeto, `taskgraph constructor` encontraria `Object.prototype.constructor` e tentaria executá-lo como comando. Com `Map`, só existem as chaves que foram inseridas.

### 2.2 Comandos que escrevem e comandos que só leem

Quando `writes` é `true`, o comando roda dentro de `update()`, que faz tudo com o arquivo travado: lê, executa o handler e grava. Se o handler lançar um erro, nada é gravado. Comandos que só leem usam `load()` direto, sem cadeado, porque a gravação é atômica e quem lê sempre vê uma versão inteira.

## 3. O cadeado e a gravação atômica

Dois problemas diferentes, duas soluções.

**Arquivo pela metade.** Se o programa escrevesse direto em `dados.json` e a energia caísse no meio, o JSON ficaria truncado. Por isso `save()` escreve em `dados.json.<pid>.tmp` e depois chama `rename`. Renomear é uma operação atômica no sistema de arquivos: o nome aponta para a versão antiga ou para a nova, nunca para uma metade de cada.

**Duas execuções ao mesmo tempo.** Imagine dois terminais rodando `taskgraph add` juntos. Ambos leem a lista com 5 tarefas, ambos criam a tarefa 6 e o último a gravar apaga o trabalho do primeiro. A gravação atômica não resolve isso, porque o problema está na leitura antes da gravação. A solução é um cadeado:

```ts
openSync(lockPath, "wx"); // "wx" falha se o arquivo já existe
```

Quem consegue criar `dados.json.lock` segue em frente, e quem não consegue espera 25 ms e tenta de novo, até um limite de 3 segundos. Ao terminar, quem criou apaga o arquivo. Se um processo morrer com o cadeado, o `.lock` fica órfão, e por isso um `.lock` com mais de 10 segundos é tratado como sobra e removido.

## 4. Validação ao carregar e ao gravar

`load()` faz duas verificações.

1. **Forma:** o JSON tem os campos certos, com os tipos certos? (`isTask`)
2. **Integridade:** as regras que a forma não garante. (`integrityProblem`)
   - ids únicos e positivos
   - `nextId` maior que qualquer id em uso
   - nenhuma dependência repetida, de si mesma ou para um id que não existe
   - nenhum ciclo no grafo

`save()` repete a verificação de integridade antes de gravar. Se ela falhar, o erro é um bug do programa, não do usuário, então lança um `Error` comum em vez de um `TaskError`.

## 5. Os algoritmos de grafo

Tudo está em `src/graph.ts`. Seja V o número de tarefas e E o número de dependências.

### 5.1 Quando uma tarefa está bloqueada

Uma tarefa está bloqueada se alguma de suas dependências existe e ainda não foi concluída. Uma dependência que não existe mais não bloqueia.

### 5.2 Detectar ciclo antes de criar a dependência

Fazer a tarefa A depender de B fecha um ciclo se B já depender de A, direta ou indiretamente. A função `wouldCreateCycle` faz uma busca em profundidade seguindo as dependências de B, e se encontrar A no caminho, o ciclo existiria.

Exemplo com `1 <- 2 <- 3` (3 depende de 2, que depende de 1). Tentar `dep 1 3` significa que 1 passaria a depender de 3. A busca parte de 3, segue para 2, depois para 1, e encontra o alvo. Ciclo detectado. Custo: O(V + E).

### 5.3 Detectar ciclo no grafo inteiro

`hasCycle` usa o algoritmo de Kahn, que serve também para ordenação topológica.

1. Conte quantas dependências cada tarefa tem.
2. Coloque numa fila as que têm zero.
3. Retire uma da fila e, para cada tarefa que depende dela, diminua o contador em um. Se chegar a zero, entra na fila.
4. No fim, se alguma tarefa nunca entrou na fila, ela está presa num ciclo.

Custo: O(V + E).

### 5.4 Pontuação

```
pontos = prioridade x 10  +  bônus de prazo  +  5 por tarefa pendente que ela libera
```

O terceiro termo usa `downstreamCount`, que anda pelo grafo invertido (`dependents`) a partir da tarefa e conta as pendentes que encontra.

Com o exemplo do README, em que 2 depende de 1, e 3 e 4 dependem de 2:

| Tarefa | Prioridade | Prazo | Libera | Cálculo | Pontos |
|--------|-----------:|-------|-------:|---------|-------:|
| #1 | alta (30) | hoje (+20) | 3 | 30 + 20 + 15 | 65 |
| #2 | alta (30) | nenhum | 2 | 30 + 0 + 10 | 40 |
| #3 | média (20) | em 3 dias (+10) | 0 | 20 + 10 + 0 | 30 |
| #4 | média (20) | em 10 dias (0) | 0 | 20 + 0 + 0 | 20 |
| #5 | baixa (10) | nenhum | 0 | 10 | 10 |

### 5.5 `next` e `plan`

`next` filtra as pendentes que não estão bloqueadas e ordena pela pontuação. Só aparece o que já dá para fazer.

`plan` é uma ordenação topológica com desempate. Em cada rodada, entre as tarefas cujas dependências já entraram no plano, escolhe a de maior pontuação. É por isso que uma tarefa urgente que depende de outra menos urgente nunca passa na frente dela: enquanto a dependência não entrou no plano, a tarefa nem é candidata.

Custo: a pontuação de todas as tarefas é O(V · (V + E)). O laço do plano repete V vezes um filtro e uma ordenação, o que dá algo da ordem de V² log V mais V · E. Para uso pessoal, com algumas centenas de tarefas, é instantâneo.

## 6. Testes

Os testes usam o runner nativo do Node. Em `tests/helpers.ts` há uma data fixa (`NOW`) e uma fábrica `mk()` que cria tarefas com valores padrão, para cada teste só escrever o que importa para ele.

O `run()` recebe a data atual, o caminho do arquivo e as funções de saída como parâmetros, em vez de usar `Date.now()` e `console.log` direto. É essa injeção que deixa os testes de linha de comando determinísticos: `hoje` e `+3d` sempre dão o mesmo resultado.

| Arquivo | Camada |
|---------|--------|
| `dates.test.ts` | datas e prazos |
| `graph.test.ts` | algoritmos de grafo |
| `service.test.ts` | regras de negócio |
| `store.test.ts` | validação, gravação atômica e cadeado |
| `cli.test.ts` | o programa de ponta a ponta |

## 7. Ordem sugerida de leitura

1. `types.ts` e `errors.ts`, curtos, dão o vocabulário.
2. `dates.ts`, funções puras e fáceis de testar de cabeça.
3. `graph.ts`, o coração do projeto.
4. `service.ts`, como as regras usam o grafo.
5. `store.ts`, persistência, validação e cadeado.
6. `commands.ts` e `cli.ts`, onde tudo se encontra.
7. `tests/`, que mostram o comportamento esperado com exemplos concretos.

## 8. Perguntas para praticar

1. Por que `wouldCreateCycle` parte de `dep` e procura `id`, e não o contrário?
2. O que acontece se dois processos encontrarem um `.lock` velho ao mesmo tempo? Que melhoria resolveria isso?
3. Por que o `nextId` fica gravado no arquivo em vez de ser calculado como `max(id) + 1`?
4. `downstreamCount` conta só as tarefas pendentes. O que mudaria no `plan` se contasse também as concluídas?
5. Como mudar a pontuação para que o prazo pese mais do que a prioridade? Quais testes quebrariam?
6. O `plan` recalcula a pontuação uma vez só, no começo. Em que situação ele poderia ficar melhor recalculando a cada rodada?
7. Como estender o projeto para guardar uma estimativa de tempo e mostrar o caminho crítico?
