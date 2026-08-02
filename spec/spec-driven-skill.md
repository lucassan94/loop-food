# Skill: Spec Driven Development Assistant

## Objetivo

Você é responsável por manter a documentação do projeto sempre
sincronizada com a implementação. A especificação é a fonte de verdade.
Código e documentação nunca devem divergir.

------------------------------------------------------------------------

# Estrutura obrigatória

``` text
/spec
    vision.md
    requirements.md
    architecture.md
    decisions.md
    progress.md
    backlog.md
    technical-debt.md
    changelog.md
```

Todos esses arquivos devem existir e ser mantidos atualizados durante
todo o ciclo de desenvolvimento.

------------------------------------------------------------------------

# Regras gerais

Após **toda execução**, **toda implementação**, **todo bug corrigido**,
**toda refatoração** ou **qualquer alteração de arquitetura**, execute
obrigatoriamente a seguinte rotina:

1.  Validar se a implementação atende à especificação.
2.  Atualizar todos os documentos afetados.
3.  Nunca apagar histórico relevante.
4.  Nunca registrar informações inventadas.
5.  Sempre registrar decisões importantes e impactos.
6.  Se nenhum arquivo precisar ser alterado, declarar explicitamente
    isso.

------------------------------------------------------------------------

# vision.md

## Finalidade

Representa a visão do produto.

## Atualização

Atualize somente quando houver mudança estratégica.

## Conteúdo

-   Objetivo do produto
-   Público-alvo
-   Escopo
-   Módulos
-   Restrições de negócio
-   Fora do escopo

Nunca registrar detalhes técnicos.

------------------------------------------------------------------------

# requirements.md

## Finalidade

Fonte oficial dos requisitos.

## Atualização

Sempre que um requisito surgir, mudar ou for removido.

## Estrutura

-   Requisitos Funcionais (RF)
-   Requisitos Não Funcionais (RNF)
-   Regras de Negócio (RN)
-   Critérios de Aceite

Cada requisito deve possuir um identificador.

Exemplo

RF-001 RN-003 RNF-002

------------------------------------------------------------------------

# architecture.md

## Finalidade

Representar a arquitetura atual do sistema.

## Atualização

Sempre que houver alteração em:

-   Serviços
-   Containers
-   Banco
-   APIs
-   Mensageria
-   Infraestrutura
-   Autenticação
-   Fluxos
-   Integrações

Registrar:

-   Componentes
-   Dependências
-   Fluxo de comunicação
-   Tecnologias
-   Diagramas em Mermaid quando possível

Nunca deixar arquitetura desatualizada.

------------------------------------------------------------------------

# decisions.md

## Finalidade

Registrar decisões arquiteturais (ADR).

## Criar uma nova decisão quando houver:

-   mudança tecnológica
-   mudança arquitetural
-   escolha entre alternativas
-   trade-offs importantes

Formato

-   ID
-   Data
-   Contexto
-   Problema
-   Alternativas
-   Decisão
-   Consequências

Nunca editar decisões antigas; criar novas ADRs.

------------------------------------------------------------------------

# progress.md

## Finalidade

Representar o estado atual do projeto.

Atualizar após toda execução.

Registrar:

-   Última atividade
-   O que foi concluído
-   O que está em andamento
-   Pendências
-   Bloqueadores
-   Próximo passo recomendado
-   Arquivos modificados
-   Cobertura aproximada da especificação (%)

Este arquivo representa a memória operacional do projeto.

------------------------------------------------------------------------

# backlog.md

## Finalidade

Lista priorizada de tudo que ainda precisa ser feito.

Categorias sugeridas

-   Alta
-   Média
-   Baixa

Cada item deve conter:

-   descrição
-   prioridade
-   motivo
-   dependências (quando houver)

Novos itens identificados durante o desenvolvimento devem ser
adicionados automaticamente.

------------------------------------------------------------------------

# technical-debt.md

## Finalidade

Registrar todas as dívidas técnicas.

Sempre registrar:

-   descrição
-   motivo
-   impacto
-   prioridade
-   recomendação
-   quando remover

Nunca esconder uma dívida técnica.

------------------------------------------------------------------------

# changelog.md

## Finalidade

Histórico cronológico do projeto.

Atualizar após qualquer alteração.

Formato sugerido

Versão

Adicionado

Alterado

Corrigido

Removido

Refatorado

------------------------------------------------------------------------

# Checklist obrigatório após cada execução

Responder internamente utilizando esta ordem lógica e refletir as
mudanças na documentação:

-   O que foi implementado?
-   Quais requisitos foram atendidos?
-   Houve mudança arquitetural?
-   Alguma decisão foi tomada?
-   Surgiram novas pendências?
-   Surgiram bugs?
-   Surgiram dívidas técnicas?
-   Alguma documentação ficou desatualizada?
-   Quais módulos foram impactados?
-   Existe risco de regressão?
-   Qual é o próximo passo de maior valor?

------------------------------------------------------------------------

# Critérios de qualidade

Sempre verificar:

-   inconsistências entre código e especificação
-   código duplicado
-   alto acoplamento
-   baixa coesão
-   responsabilidades misturadas
-   componentes reutilizáveis
-   oportunidades de refatoração
-   impactos em outros módulos
-   riscos futuros

Registrar qualquer descoberta nos arquivos apropriados.

------------------------------------------------------------------------

# Princípios

-   A especificação sempre prevalece sobre o código.
-   Nunca deixar documentação atrasada.
-   Nunca concluir uma tarefa sem atualizar a documentação
    correspondente.
-   Se identificar divergência entre implementação e especificação,
    registrar imediatamente e informar o usuário.
