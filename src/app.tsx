import * as React from 'react'
import * as _ from 'lodash'
import { Canvas } from './Canvas'
import { Recipe } from './Recipe'
import { Navbar } from './Navbar'
import { Config, RecipePath } from './Config'
import { Container, Row, Col, Modal } from 'reactstrap'
import { ocr } from './google'
import * as adapters from './adapters'
import { RecipeParts, MarkdownRecipe } from './models'
import * as Mousetrap from 'mousetrap'
import { transcribe } from './transcribe'
import { parse } from 'path'
import { create } from './create'
import { writeFileSync } from 'fs'
import { toMarkdown } from './markdown'
import { archive, download, convert, rotate } from './utils'
import log from 'electron-log'
import { ipcRenderer } from 'electron'
const app = require('electron').remote.app

const load = (src: string) =>
  new Promise(resolve => {
    const image = new Image()
    image.onload = function() {
      resolve(image)
    }
    image.src = src + '?' + new Date().getTime()
  })

interface AppState {
  image?: any
  recipe: MarkdownRecipe
  active: string
  recipePath?: string
  recipeKey?: string
  userId?: number
  modal: boolean
}

export class App extends React.Component<any, AppState> {
  constructor(props: any) {
    super(props)

    this.onSelectRecipe = this.onSelectRecipe.bind(this)
    this.onSelection = this.onSelection.bind(this)
    this.onRecipeChange = this.onRecipeChange.bind(this)
    this.onActiveChange = this.onActiveChange.bind(this)
    this.onSubmit = this.onSubmit.bind(this)
    this.saveToJSON = this.saveToJSON.bind(this)
    this.next = this.next.bind(this)
    this.previous = this.previous.bind(this)
    this.loadImage = this.loadImage.bind(this)
    this.finished = this.finished.bind(this)
    this.rotate = this.rotate.bind(this)
    this.state = {
      recipe: {
        title: '',
        subtitle: '',
        description: '',
        ingredients: '',
        procedures: '',
        yld: '',
        duration: ''
      },
      active: 'title',
      modal: false
    }

    ipcRenderer.on('load-image', this.loadImage)
    ipcRenderer.on('finished', this.finished)
  }

  public componentDidMount() {
    Mousetrap.bind(
      [
        'command+t',
        'command+s',
        'command+d',
        'command+i',
        'command+o',
        'command+y',
        'command+u'
      ],
      ({ key }) => {
        this.shortcut(key)
      }
    )
    Mousetrap.bind('command+n', this.next)
    Mousetrap.bind('command+p', this.previous)
  }

  public loadImage() {
    this.setState({
      modal: true
    })
  }

  public finished() {
    this.setState({
      recipe: {
        title: '',
        subtitle: '',
        description: '',
        ingredients: '',
        procedures: '',
        yld: '',
        duration: ''
      },
      active: 'title',
      modal: false,
      image: undefined,
      recipePath: undefined,
      recipeKey: undefined,
      userId: undefined
    })
  }

  public shortcut(key: string) {
    const active = _.first(_.filter(RecipeParts, { key }))
    if (active) {
      this.setState({ active: active.val })
    }
  }

  public async rotate(degrees: string) {
    try {
      const { recipePath } = this.state
      if (!recipePath) {
        return
      }
      await rotate(recipePath, degrees)
      const image = await load(recipePath)
      this.setState({ image })
    } catch (err) {
      alert(err)
    }
  }

  public next(): boolean {
    let i = _.findIndex(RecipeParts, r => r.val === this.state.active)
    if (i == RecipeParts.length - 1) {
      i = 0
    } else {
      i++
    }
    this.setState({ active: RecipeParts[i].val })
    return false
  }

  public previous(): boolean {
    let i = _.findIndex(RecipeParts, r => r.val === this.state.active)
    if (i == 0) {
      i = RecipeParts.length - 1
    } else {
      i--
    }
    this.setState({ active: RecipeParts[i].val })
    return false
  }

  public async onSelectRecipe(r: RecipePath) {
    log.info(r)
    try {
      const folder = app.getPath('userData')
      const path = await download(r.key, folder)
      const { base } = parse(path)
      const recipePath = await convert(folder, base)
      const image = await load(recipePath)
      log.info('converted', recipePath)
      this.setState({
        image,
        recipeKey: r.key,
        recipePath,
        userId: r.userId,
        modal: false
      })
    } catch (err) {
      log.error(err)
      if (
        confirm(`${err.message}
        
Do you want to open a blank recipe for this user?`)
      ) {
        this.setState({
          image: new Image(),
          recipeKey: r.key,
          recipePath: '/dev/null',
          userId: r.userId,
          modal: false
        })
      }
    }
  }

  public async onSelection(buffer: Buffer) {
    console.log('onSelection', this.state)
    const result = await ocr(buffer)
    const adapter = adapters[this.state.active]
    let val = adapter ? adapter(result) : result
    this.setState(
      (s: AppState) => ({
        ...s,
        recipe: {
          ...s.recipe,
          [s.active]: s.recipe[s.active] + val
        }
      }),
      this.next
    )
  }

  // When the user directly edits the markdown
  public onRecipeChange(prop: string, val: any) {
    console.log('onRecipeChange', this.state)
    this.setState(s => ({
      ...s,
      active: prop,
      recipe: {
        ...s.recipe,
        [prop]: val
      }
    }))
  }

  public onActiveChange(active: string) {
    console.log('onActiveChange', this.state)
    this.setState({ active })
  }

  private transcribe(recipe: MarkdownRecipe): Recipe {
    const md = toMarkdown(recipe)
    const json = transcribe(md)
    if (!json.subtitle) {
      delete json['subtitle']
    }
    if (!json.description) {
      delete json['description']
    }
    return json
  }

  public async saveToJSON(recipe: MarkdownRecipe) {
    writeFileSync(
      'recipe.json',
      JSON.stringify(this.transcribe(recipe), null, 2)
    )
  }

  public async onSubmit(recipe: MarkdownRecipe) {
    const json = this.transcribe(recipe)
    try {
      const { userId } = this.state
      if (!userId) {
        throw new Error('No UserID Found to create recipe!')
      }
      const created = await create(userId, json)
      log.info('Saved Recipe', created)
      if (this.state.recipeKey) {
        await archive(this.state.recipeKey)
      }
      this.setState({
        active: 'title',
        recipe: {
          title: '',
          subtitle: '',
          description: '',
          ingredients: '',
          procedures: '',
          yld: '',
          duration: ''
        },
        image: undefined,
        recipePath: undefined,
        recipeKey: undefined
      })
    } catch (err) {
      alert(err)
    }
  }

  public render() {
    const { image } = this.state
    if (!image) {
      return (
        <Container>
          <Config onSelect={this.onSelectRecipe} />
        </Container>
      )
    }

    return (
      <div>
        <Navbar active={this.state.active} onClick={this.onActiveChange} />
        <Row>
          <Col xs="9" className="position-relative">
            <Canvas onSelection={this.onSelection} image={image} />
            <button
              className="position-absolute"
              style={{ left: 0, top: 0 }}
              onClick={() => this.rotate('-90')}
            >
              left
            </button>
            <button
              className="position-absolute"
              style={{ right: 0, top: 0 }}
              onClick={() => this.rotate('90')}
            >
              right
            </button>
          </Col>
          <Col xs="3" style={{ maxHeight: '960px', overflow: 'auto' }}>
            <Recipe
              recipe={this.state.recipe}
              active={this.state.active}
              onChange={this.onRecipeChange}
              onSubmit={this.onSubmit}
              onSubmitJSON={this.saveToJSON}
            />
          </Col>
        </Row>
        <Modal
          isOpen={this.state.modal}
          toggle={() => {
            this.setState(s => ({
              modal: !s.modal
            }))
          }}
        >
          <Config onSelect={this.onSelectRecipe} />
        </Modal>
      </div>
    )
  }
}
