/**
 * Module Resolver for E2E Runner
 *
 * Enables reusable action sequences via $use references.
 * Modules are JSON files in the modules directory with a $module key.
 *
 * Features:
 * - Parameter substitution: {{param}} and {{#param}}...{{/param}} conditionals
 * - Module composition: modules can $use other modules
 * - Cycle detection: prevents infinite recursion
 * - Fail-fast: required params without values throw immediately
 */

import fs from 'fs';
import path from 'path';

/**
 * Loads all module definitions from a directory.
 * @param {string} modulesDir - Absolute path to modules directory
 * @returns {Map<string, object>} Map of module name -> definition
 */
export function loadModuleRegistry(modulesDir) {
  const registry = new Map();

  if (!modulesDir || !fs.existsSync(modulesDir)) {
    return registry;
  }

  const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(modulesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    if (!data.$module) {
      continue; // Not a module definition
    }

    if (registry.has(data.$module)) {
      throw new Error(`Duplicate module name "${data.$module}" in ${file}`);
    }

    registry.set(data.$module, data);
  }

  return registry;
}

/**
 * Replaces {{param}} placeholders and {{#param}}...{{/param}} conditionals in a string.
 * @param {string} str - Template string
 * @param {object} params - Parameter values
 * @param {object} paramDefs - Parameter definitions from the module (for defaults)
 * @returns {string} Resolved string
 */
function substituteParams(str, params, paramDefs) {
  if (typeof str !== 'string') return str;

  // Build effective params: defaults + provided
  const effective = {};
  if (paramDefs) {
    for (const [key, def] of Object.entries(paramDefs)) {
      if (def.default !== undefined) {
        effective[key] = def.default;
      }
    }
  }
  Object.assign(effective, params);

  // Process conditional blocks: {{#key}}content{{/key}}
  let result = str.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    const val = effective[key];
    if (val !== undefined && val !== '' && val !== null && val !== false) {
      // Recursively substitute inside the block
      return substituteParams(content, params, paramDefs);
    }
    return '';
  });

  // Process simple substitutions: {{key}}
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in effective) return String(effective[key]);
    return match; // Leave unresolved (will be caught by validation)
  });

  return result;
}

/**
 * Applies parameter substitution to all string fields of an action.
 * @param {object} action - Action object
 * @param {object} params - Parameter values
 * @param {object} paramDefs - Parameter definitions
 * @returns {object} New action with substituted values
 */
function substituteActionParams(action, params, paramDefs, moduleName) {
  const result = {};
  for (const [key, value] of Object.entries(action)) {
    if (typeof value === 'string') {
      result[key] = substituteParams(value, params, paramDefs);
    } else {
      result[key] = value;
    }
  }

  // Check for unresolved placeholders
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      const unresolved = value.match(/\{\{(\w+)\}\}/g);
      if (unresolved) {
        const paramNames = unresolved.map(m => m.slice(2, -2));
        throw new Error(`Module "${moduleName || 'unknown'}": unresolved parameter(s) ${paramNames.join(', ')} in "${key}". Provide them via params or define defaults.`);
      }
    }
  }

  return result;
}

/**
 * Validates that all required parameters have values.
 * @param {object} paramDefs - Parameter definitions from module
 * @param {object} params - Provided parameter values
 * @param {string} moduleName - Module name for error messages
 */
function validateParams(paramDefs, params, moduleName) {
  if (!paramDefs) return;

  for (const [key, def] of Object.entries(paramDefs)) {
    if (def.required && !(key in params) && def.default === undefined) {
      throw new Error(`Module "${moduleName}": missing required parameter "${key}"`);
    }
  }
}

/**
 * Resolves an array of actions, expanding $use references recursively.
 * @param {Array} actions - Array of actions (may contain $use references)
 * @param {Map} registry - Module registry
 * @param {object} contextParams - Parameters from parent scope
 * @param {Set} visited - Set of module names in the current resolution chain (cycle detection)
 * @returns {Array} Flattened array of concrete actions
 */
function resolveActions(actions, registry, contextParams = {}, visited = new Set()) {
  const resolved = [];

  for (const action of actions) {
    if (action.$use) {
      const moduleName = action.$use;

      // Cycle detection
      if (visited.has(moduleName)) {
        throw new Error(`Circular module dependency detected: ${[...visited, moduleName].join(' -> ')}`);
      }

      const moduleDef = registry.get(moduleName);
      if (!moduleDef) {
        throw new Error(`Module not found: "${moduleName}". Available: ${[...registry.keys()].join(', ') || 'none'}`);
      }

      // Merge params: context params as fallback, then explicit params
      const mergedParams = { ...contextParams, ...action.params };
      validateParams(moduleDef.params, mergedParams, moduleName);

      // Recursively resolve the module's actions
      const newVisited = new Set(visited);
      newVisited.add(moduleName);

      const moduleActions = moduleDef.actions || [];
      const substituted = moduleActions.map(a => {
        if (a.$use) {
          // Nested $use — pass through for recursive resolution
          return { ...a, params: { ...mergedParams, ...a.params } };
        }
        return substituteActionParams(a, mergedParams, moduleDef.params, moduleName);
      });

      const expandedActions = resolveActions(substituted, registry, mergedParams, newVisited);
      resolved.push(...expandedActions);
    } else {
      resolved.push(action);
    }
  }

  return resolved;
}

/**
 * Resolves all $use references in a test data structure.
 * @param {object} data - { tests, hooks } as returned by normalizeTestData
 * @param {string} modulesDir - Absolute path to modules directory
 * @returns {object} New { tests, hooks } with all $use expanded
 */
export function resolveTestData(data, modulesDir) {
  if (!modulesDir || !fs.existsSync(modulesDir)) {
    return data; // No modules directory — pass through unchanged
  }

  const registry = loadModuleRegistry(modulesDir);
  if (registry.size === 0) {
    return data; // No modules defined — pass through
  }

  // Check if there are any $use references to resolve
  const hasUseRef = (actions) => actions?.some(a => a.$use);
  const hooksNeedResolving = Object.values(data.hooks || {}).some(hasUseRef);
  const testsNeedResolving = data.tests?.some(t => hasUseRef(t.actions));

  if (!hooksNeedResolving && !testsNeedResolving) {
    return data; // No $use references — pass through
  }

  // Resolve hooks
  const resolvedHooks = {};
  for (const [hookName, actions] of Object.entries(data.hooks || {})) {
    if (Array.isArray(actions)) {
      resolvedHooks[hookName] = resolveActions(actions, registry);
    } else {
      resolvedHooks[hookName] = actions;
    }
  }

  // Resolve test actions
  const resolvedTests = (data.tests || []).map(test => {
    if (!hasUseRef(test.actions)) return test;
    return {
      ...test,
      actions: resolveActions(test.actions, registry),
    };
  });

  return { tests: resolvedTests, hooks: resolvedHooks };
}

/**
 * Lists available modules with their metadata.
 * @param {string} modulesDir - Absolute path to modules directory
 * @returns {Array<{name, description, params, file}>} Module metadata
 */
export function listModules(modulesDir) {
  if (!modulesDir || !fs.existsSync(modulesDir)) {
    return [];
  }

  const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.json'));
  const modules = [];

  for (const file of files) {
    const filePath = path.join(modulesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    if (!data.$module) continue;

    const paramList = data.params
      ? Object.entries(data.params).map(([name, def]) => ({
          name,
          required: !!def.required,
          default: def.default,
          description: def.description,
        }))
      : [];

    modules.push({
      name: data.$module,
      description: data.description || '',
      file,
      actionCount: (data.actions || []).length,
      params: paramList,
    });
  }

  return modules;
}
