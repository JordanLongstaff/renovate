import { query as q } from 'good-enough-parser';
import { regEx } from '../../../../util/regex';
import type { Ctx } from '../types';
import {
  GRADLE_PLUGINS,
  GRADLE_TEST_SUITES,
  cleanupTempVars,
  qArtifactId,
  qDotOrBraceExpr,
  qGroupId,
  qTemplateString,
  qValueMatcher,
  qVersion,
  storeInTokenMap,
  storeVarToken,
} from './common';
import {
  handleDepString,
  handleImplicitDep,
  handleKotlinShortNotationDep,
  handleLongFormDep,
} from './handlers';

// "foo:bar:1.2.3"
// "foo:bar:$baz"
// "foo" + "${bar}" + baz
export const qDependencyStrings = qTemplateString
  .opt(q.op<Ctx>('+').join(qValueMatcher))
  .handler((ctx: Ctx) => storeInTokenMap(ctx, 'templateStringTokens'))
  .handler(handleDepString)
  .handler(cleanupTempVars);

// dependencySet(group: 'foo', version: bar) { entry 'baz' }
const qDependencySet = q
  .sym<Ctx>('dependencySet', storeVarToken)
  .handler((ctx) => storeInTokenMap(ctx, 'methodName'))
  .tree({
    type: 'wrapped-tree',
    maxDepth: 1,
    startsWith: '(',
    endsWith: ')',
    search: q
      .begin<Ctx>()
      .sym('group')
      .alt(q.op(':'), q.op('='))
      .join(qGroupId)
      .op(',')
      .sym('version')
      .alt(q.op(':'), q.op('='))
      .join(qVersion)
      .end(),
  })
  .tree({
    type: 'wrapped-tree',
    maxDepth: 1,
    startsWith: '{',
    endsWith: '}',
    search: q
      .sym<Ctx>('entry')
      .alt(
        qArtifactId,
        q.tree({
          type: 'wrapped-tree',
          maxDepth: 1,
          startsWith: '(',
          endsWith: ')',
          search: q.begin<Ctx>().join(qArtifactId).end(),
        }),
      )
      .handler(handleLongFormDep),
  })
  .handler(cleanupTempVars);

// group: "foo", name: "bar", version: "1.2.3"
export const qGroovyMapNotationDependencies = q
  .sym<Ctx>('group')
  .op(':')
  .join(qGroupId)
  .op(',')
  .sym('name')
  .op(':')
  .join(qArtifactId)
  .op(',')
  .sym('version')
  .op(':')
  .join(qVersion)
  .handler(handleLongFormDep)
  .handler(cleanupTempVars);

// kotlin("bom", "1.7.21")
const qKotlinShortNotationDependencies = q
  .sym<Ctx>('kotlin')
  .tree({
    type: 'wrapped-tree',
    maxDepth: 1,
    startsWith: '(',
    endsWith: ')',
    search: q
      .begin<Ctx>()
      .join(qArtifactId)
      .op(',')
      .opt(q.sym<Ctx>('version').op('='))
      .join(qVersion)
      .end(),
  })
  .handler(handleKotlinShortNotationDep)
  .handler(cleanupTempVars);

// (group = "foo", name = "bar", version = "1.2.3")
const qKotlinMapNotationDependencies = q
  .tree({
    type: 'wrapped-tree',
    maxDepth: 1,
    startsWith: '(',
    endsWith: ')',
    search: q
      .begin<Ctx>()
      .sym('group')
      .op('=')
      .join(qGroupId)
      .op(',')
      .sym('name')
      .op('=')
      .join(qArtifactId)
      .op(',')
      .sym('version')
      .op('=')
      .join(qVersion),
  })
  .handler(handleLongFormDep)
  .handler(cleanupTempVars);

// someMethod("foo", "bar", "1.2.3")
export const qLongFormDep = q
  .opt<Ctx>(
    q.sym(storeVarToken).handler((ctx) => storeInTokenMap(ctx, 'methodName')),
  )
  .tree({
    type: 'wrapped-tree',
    maxDepth: 1,
    maxMatches: 1,
    startsWith: '(',
    endsWith: ')',
    search: q
      .begin<Ctx>()
      .join(qGroupId)
      .op(',')
      .join(qArtifactId)
      .op(',')
      .join(qVersion)
      .end(),
  })
  .handler(handleLongFormDep)
  .handler(cleanupTempVars);

// pmd { toolVersion = "1.2.3" }
const qImplicitGradlePlugin = q
  .alt(
    ...Object.keys(GRADLE_PLUGINS).map((implicitDepName) =>
      q
        .sym<Ctx>(implicitDepName, storeVarToken)
        .handler((ctx) => storeInTokenMap(ctx, 'implicitDepName'))
        .tree({
          type: 'wrapped-tree',
          maxDepth: 1,
          maxMatches: 1,
          startsWith: '{',
          endsWith: '}',
          search: q
            .sym<Ctx>(
              GRADLE_PLUGINS[implicitDepName as keyof typeof GRADLE_PLUGINS][0],
            )
            .alt(
              // toolVersion = "1.2.3"
              q.opt<Ctx>(q.op('=')).join(qVersion),
              // toolVersion.set("1.2.3"), toolVersion.value("1.2.3")
              q
                .op<Ctx>('.')
                .sym(regEx(/^(?:set|value)$/))
                .tree({
                  maxDepth: 1,
                  startsWith: '(',
                  endsWith: ')',
                  search: q.begin<Ctx>().join(qVersion).end(),
                }),
            ),
        }),
    ),
  )
  .handler(handleImplicitDep)
  .handler(cleanupTempVars);

// testing { suites { test { useSpock("1.2.3") } } }
const qImplicitTestSuites = qDotOrBraceExpr(
  'testing',
  qDotOrBraceExpr(
    'suites',
    qDotOrBraceExpr(
      'test',
      q
        .sym(
          regEx(`^(?:${Object.keys(GRADLE_TEST_SUITES).join('|')})$`),
          storeVarToken,
        )
        .handler((ctx) => storeInTokenMap(ctx, 'implicitDepName'))
        .tree({
          type: 'wrapped-tree',
          maxDepth: 1,
          maxMatches: 1,
          startsWith: '(',
          endsWith: ')',
          search: q.begin<Ctx>().join(qVersion).end(),
        }),
    ),
  ),
)
  .handler(handleImplicitDep)
  .handler(cleanupTempVars);

export const qDependencies = q.alt(
  qDependencyStrings,
  qDependencySet,
  qGroovyMapNotationDependencies,
  qKotlinShortNotationDependencies,
  qKotlinMapNotationDependencies,
  qImplicitGradlePlugin,
  qImplicitTestSuites,
  // avoid heuristic matching of gradle feature variant capabilities
  qDotOrBraceExpr('java', q.sym<Ctx>('registerFeature').tree()),
);
