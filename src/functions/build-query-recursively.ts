import {GraphQLQueryTree} from "../";
import {RelationMetadata} from "typeorm/metadata/RelationMetadata";
import {EntityMetadata, SelectQueryBuilder} from "typeorm";

/**
 * @description Builds a TypeORM query with the queryBuilder recursively, joining every requested relation,
 * selecting every asked attribute, and adding query options.
 * @param tree GraphQLQueryTree
 * @param qb SelectQueryBuilder
 * @param alias Entity alias
 * @param metadata EntityMetadata
 */
export function buildQueryRecursively<T>(
    tree: GraphQLQueryTree<T>,
    qb: SelectQueryBuilder<T>,
    alias: string,
    metadata: EntityMetadata
) {
    const options = tree.properties.options;
    const selectSet = new Set(qb.expressionMap.selects.map(select => select.selection));
    // Firstly, we list all selected fields at this level of the query tree
    const selectedFields = tree.fields
        .reduce((acc, field) => {
            const selection = alias + "." + field.name
            if (field.isRelation() || selectSet.has(selection)) {
                return acc;
            }
            acc.add(selection)
            return acc;
        }, new Set<string>());
        // .filter((field: GraphQLQueryTree<T>) => !field.isRelation())
        // .map((field: GraphQLQueryTree<T>) => alias + "." + field.name);

    // Secondly, we list all fields used in arguments
    const argFields = Object
        .keys(tree.properties.args)
        .reduce((acc, arg) => {
            const argSelection = alias + "." + arg;
            if (selectSet.has(argSelection)) {
                return acc;
            }
            acc.add(argSelection);
            return acc;
        }, new Set<string>());

    // We select all of above
    qb.addSelect(Array.from(argFields));
    qb.addSelect(Array.from(selectedFields));

    // We add order options
    Object.keys(options.order)
        .forEach((key: string) => {
            qb.addOrderBy(alias + "." + key, options.order[key]);
        });

    // We add args filters
    Object.keys(tree.properties.args)
        .forEach((key: string) => {
            if(Array.isArray(tree.properties.args[key])) {
                qb.andWhere(alias + "." + key + " IN (:" + key + ")", { [`${key}`]: tree.properties.args[key] });
            } else {
                qb.andWhere(alias + "." + key + " = :" + key, { [`${key}`]: tree.properties.args[key] });
            }
        });

    if (options.paginate.offset) {
        qb.skip(options.paginate.offset);
    }

    if (options.paginate.limit) {
        qb.take(options.paginate.limit);
    }

    // For each asked relation
    const joinSet = new Set(qb.expressionMap.joinAttributes.map(join => join.entityOrProperty));
    const newJoins = new Set<string>();
    tree.fields
        .filter((field: GraphQLQueryTree<T>) => field.isRelation())
        .forEach((relationTree: GraphQLQueryTree<T>) => {
            const relation: RelationMetadata = metadata.findRelationWithPropertyPath(relationTree.name);

            // If the relation query tree is asking for exists, we join it recursively
            if (relation) {
                const path = alias + "." + relation.propertyPath;
                if (!joinSet.has(path) && !newJoins.has(path)) {
                    newJoins.add(path);
                    qb.leftJoin(path, alias);
                }

                buildQueryRecursively(relationTree, qb, alias, relation.inverseEntityMetadata);
            }
        });
}
