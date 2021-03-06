import { mapValues } from './importer'
import * as moment from 'moment'
import * as html from './html'

const title = html.text('h1')
const subtitle = html.text('h2')
const description = html.text('p')

const preheats = ($: any) => {
  return $('meta[itemprop="preheat"]')
    .map(function(this: any) {
      const [name, temperature, unit] = $(this)
        .attr('content')
        .split(' ')
      return {
        name,
        temperature: parseInt(temperature),
        unit
      }
    })
    .get()
}

const yld = ($: any) => $('meta[itemprop="recipeYield"]').attr('content')

const duration = ($: any) =>
  moment.duration($('meta[itemprop="cookTime"]').attr('content')).asSeconds()

const ingredient_lists = html.ingredient_lists('ul li')
const procedure_lists = html.procedure_lists('ol li')

export const OCR = mapValues(
  html.defaults({
    title,
    subtitle,
    description,
    yield: yld,
    duration,
    preheats,
    ingredient_lists,
    procedure_lists
  })
)
