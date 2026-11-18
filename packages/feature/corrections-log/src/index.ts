/**
 * A durable record of the corrections that deliberately never reach the
 * transcript.
 *
 * A whole class of event is invisible by design (ADR 0009): a call's input is
 * made readable by a fix that cannot change a value, or a tool refuses a call
 * as model-correctable and the model corrects it, without anyone being told.
 * That is right for a person trying to get work done, and without a record it
 * would leave nothing behind: a model that fails the same way every time could
 * not be seen at all.
 *
 * This is where those events go. It is written for someone asking what
 * happened, after the fact: what was refused or fixed, and the input as it
 * arrived and as it was fixed.
 *
 * It is not a second transcript. Nothing here is shown to the person during
 * their work, and nothing here is sent to a model.
 */

export * from "./corrections-log.js";
