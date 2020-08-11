/**
 * @license
 * Copyright (c) 2020 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt The complete set of authors may be found
 * at http://polymer.github.io/AUTHORS.txt The complete set of contributors may
 * be found at http://polymer.github.io/CONTRIBUTORS.txt Code distributed by
 * Google as part of the polymer project is also subject to an additional IP
 * rights grant found at http://polymer.github.io/PATENTS.txt
 */

import {TemplateResult} from 'lit-html';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Configuration parameters for lit-localize when in runtime mode.
 */
export interface RuntimeConfiguration {
  /**
   * Required locale code in which source templates in this project are written,
   * and the initial active locale.
   */
  sourceLocale: string;

  /**
   * Required locale codes that are supported by this project. Should not
   * include the `sourceLocale` code.
   */
  targetLocales: Iterable<string>;

  /**
   * Required function that returns a promise of the localized templates for the
   * given locale code. For security, this function will only ever be called
   * with a `locale` that is contained by `targetLocales`.
   */
  loadLocale: (locale: string) => Promise<LocaleModule>;
}

/**
 * Configuration parameters for lit-localize when in transform mode.
 */
export interface TransformConfiguration {
  /**
   * Required locale code in which source templates in this project are written,
   * and the active locale.
   */
  sourceLocale: string;
}

/**
 * The template-like types that can be passed to `msg`.
 */
export type TemplateLike =
  | string
  | TemplateResult
  | ((...args: any[]) => string)
  | ((...args: any[]) => TemplateResult);

/**
 * A mapping from template ID to template.
 */
export type TemplateMap = {[id: string]: TemplateLike};

/**
 * The expected exports of a locale module.
 */
export interface LocaleModule {
  templates: TemplateMap;
}

class Deferred<T> {
  readonly promise: Promise<T>;
  private _resolve!: (value: T) => void;
  private _reject!: (error: Error) => void;
  settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  resolve(value: T) {
    this.settled = true;
    this._resolve(value);
  }

  reject(error: Error) {
    this.settled = true;
    this._reject(error);
  }
}

let activeLocale = '';
let loadingLocale: string | undefined;
let sourceLocale: string | undefined;
let validLocales: Set<string> | undefined;
let loadLocale: ((locale: string) => Promise<LocaleModule>) | undefined;
let configured = false;
let templates: TemplateMap | undefined;
let loading = new Deferred<void>();

/**
 * Set configuration parameters for lit-localize when in runtime mode. Returns
 * an object with functions:
 *
 * - `getLocale`: Return the active locale code.
 * - `setLocale`: Set the active locale code.
 *
 * Throws if called more than once.
 */
export function configureLocalization(config: RuntimeConfiguration) {
  if (configured === true) {
    throw new Error('lit-localize can only be configured once');
  }
  configured = true;
  activeLocale = sourceLocale = config.sourceLocale;
  validLocales = new Set(config.targetLocales);
  validLocales.add(config.sourceLocale);
  loadLocale = config.loadLocale;
  return {getLocale, setLocale};
}

/**
 * Set configuration parameters for lit-localize when in transform mode. Returns
 * an object with function:
 *
 * - `getLocale`: Return the active locale code.
 *
 * Throws if called more than once.
 */
export function configureTransformLocalization(config: TransformConfiguration) {
  if (configured === true) {
    throw new Error('lit-localize can only be configured once');
  }
  configured = true;
  activeLocale = sourceLocale = config.sourceLocale;
  return {getLocale};
}

/**
 * Return the active locale code.
 */
function getLocale(): string {
  return activeLocale;
}

/**
 * Set the active locale code, and begin loading templates for that locale using
 * the `loadLocale` function that was passed to `configureLocalization`. Returns
 * a promise that resolves when the next locale is ready to be rendered.
 *
 * Note that if a second call to `setLocale` is made while the first requested
 * locale is still loading, then the second call takes precedence, and the
 * promise returned from the first call will resolve when second locale is
 * ready. If you need to know whether a particular locale was loaded, check
 * `getLocale` after the promise resolves.
 *
 * Throws if the given locale is not contained by the configured `sourceLocale`
 * or `targetLocales`.
 */
function setLocale(newLocale: string): Promise<void> {
  if (!configured || !validLocales || !loadLocale) {
    throw new Error('Must call configureLocalization before setLocale');
  }
  if (newLocale === loadingLocale ?? activeLocale) {
    return loading.promise;
  }
  if (!validLocales.has(newLocale)) {
    throw new Error('Invalid locale code');
  }
  loadingLocale = newLocale;
  if (loading.settled) {
    loading = new Deferred();
  }
  if (newLocale === sourceLocale) {
    activeLocale = newLocale;
    loadingLocale = undefined;
    templates = undefined;
    loading.resolve();
  } else {
    loadLocale(newLocale).then(
      (mod) => {
        if (newLocale === loadingLocale) {
          activeLocale = newLocale;
          loadingLocale = undefined;
          templates = mod.templates;
          loading.resolve();
        }
        // Else another locale was requested in the meantime. Don't resolve or
        // reject, because the newer load call is going to use the same promise.
        // Note the user can call getLocale() after the promise resolves if they
        // need to check if the locale is still the one they expected to load.
      },
      (err) => {
        if (newLocale === loadingLocale) {
          loading.reject(err);
        }
      }
    );
  }
  return loading.promise;
}

/**
 * Make a string or lit-html template localizable.
 *
 * @param id A project-wide unique identifier for this template.
 * @param template A string, a lit-html template, or a function that returns
 * either a string or lit-html template.
 * @param args In the case that `template` is a function, it is invoked with
 * the 3rd and onwards arguments to `msg`.
 */
export function msg(id: string, template: string): string;

export function msg(id: string, template: TemplateResult): TemplateResult;

export function msg<F extends (...args: any[]) => string>(
  id: string,
  fn: F,
  ...params: Parameters<F>
): string;

export function msg<F extends (...args: any[]) => TemplateResult>(
  id: string,
  fn: F,
  ...params: Parameters<F>
): TemplateResult;

export function msg(
  id: string,
  template: TemplateLike,
  ...params: any[]
): string | TemplateResult {
  if (templates) {
    const localized = templates[id];
    if (localized) {
      template = localized;
    }
  }
  if (typeof template === 'function') {
    return template(...params);
  }
  return template;
}
