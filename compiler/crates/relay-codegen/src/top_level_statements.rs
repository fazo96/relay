/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

use std::fmt::Result as FmtResult;

use fnv::FnvBuildHasher;
use indexmap::IndexMap;

#[derive(Default, Clone)]
pub struct TopLevelStatements(IndexMap<String, TopLevelStatement, FnvBuildHasher>);
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum TopLevelStatement {
    ImportStatement {
        module_import_name: ModuleImportName,
        path: String,
    },
    VariableDefinition(String),
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum ModuleImportName {
    Default(String),
    Named {
        name: String,
        import_as: Option<String>,
    },
}

impl std::fmt::Display for TopLevelStatement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> FmtResult {
        match self {
            TopLevelStatement::ImportStatement {
                module_import_name,
                path,
            } => match module_import_name {
                ModuleImportName::Default(default_import) => {
                    write!(f, "import {} from '{}';\n", default_import, path)?
                }
                ModuleImportName::Named { name, import_as } => {
                    if let Some(import_as) = import_as {
                        write!(f, "import {{{} as {}}} from '{}';\n", name, import_as, path)?
                    } else {
                        write!(f, "import {{{}}} from '{}';\n", name, path)?
                    }
                }
            },
            TopLevelStatement::VariableDefinition(text) => write!(f, "{}", text)?,
        };
        Ok(())
    }
}

impl TopLevelStatements {
    pub fn insert(&mut self, symbol: String, import_statement: TopLevelStatement) {
        self.0.insert(symbol, import_statement);
    }

    pub fn contains(&self, symbol: &str) -> bool {
        self.0.contains_key(symbol)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Display for TopLevelStatements {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> FmtResult {
        let mut statements = self.0.values().collect::<Vec<_>>();
        statements.sort();
        for statement in statements {
            write!(f, "{}", statement)?;
        }

        Ok(())
    }
}
