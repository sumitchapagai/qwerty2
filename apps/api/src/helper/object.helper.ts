import Big from 'big.js';
import { cloneDeep, isArray, isObject } from 'lodash';

export function hasNotDefinedValuesInObject(aObject: Object): boolean {
  for (const key in aObject) {
    if (aObject[key] === null || aObject[key] === null) {
      return true;
    } else if (isObject(aObject[key])) {
      return hasNotDefinedValuesInObject(aObject[key]);
    }
  }

  return false;
}

export function nullifyValuesInObject<T>(aObject: T, keys: string[]): T {
  const object = cloneDeep(aObject);

  if (object) {
    keys.forEach((key) => {
      object[key] = null;
    });
  }

  return object;
}

export function nullifyValuesInObjects<T>(aObjects: T[], keys: string[]): T[] {
  return aObjects.map((object) => {
    return nullifyValuesInObject(object, keys);
  });
}

export function redactAttributes({
  object,
  options
}: {
  object: any;
  options: { attribute: string; valueMap: { [key: string]: any } }[];
}): any {
  if (!object || !options || !options.length) {
    return object;
  }

  const redactedObject = cloneDeep(object);

  for (const option of options) {
    if (redactedObject.hasOwnProperty(option.attribute)) {
      if (option.valueMap['*'] || option.valueMap['*'] === null) {
        redactedObject[option.attribute] = option.valueMap['*'];
      } else if (option.valueMap[redactedObject[option.attribute]]) {
        redactedObject[option.attribute] =
          option.valueMap[redactedObject[option.attribute]];
      }
    } else {
      // If the attribute is not present on the current object,
      // check if it exists on any nested objects
      for (const property in redactedObject) {
        if (isArray(redactedObject[property])) {
          redactedObject[property] = redactedObject[property].map(
            (currentObject) => {
              return redactAttributes({ options, object: currentObject });
            }
          );
        } else if (
          isObject(redactedObject[property]) &&
          !(redactedObject[property] instanceof Big)
        ) {
          // Recursively call the function on the nested object
          redactedObject[property] = redactAttributes({
            options,
            object: redactedObject[property]
          });
        }
      }
    }
  }

  return redactedObject;
}
