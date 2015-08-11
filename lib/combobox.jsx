var React = require('react');
var guid = 0;
var k = function(){};
var eq = function(a,b){return a===b};
var addClass = require('./add-class');
var ComboboxOption = require('./option');

function getLabel(component) {
    var hasLabel = component.props.label != null;
    return hasLabel ? component.props.label : component.props.children;
}

function matchFragment(userInput, firstChildLabel) {
    userInput = userInput.toLowerCase();
    firstChildLabel = firstChildLabel.toLowerCase();
    if (userInput === '' || userInput === firstChildLabel) {
        return false;
    }
    if (firstChildLabel.toLowerCase().indexOf(userInput.toLowerCase()) === -1) {
        return false;
    }
    return true;
}


module.exports = React.createClass({

    propTypes: {

        /**
         * Defaults to 'both'. 'inline' will autocomplete the first matched Option
         * into the input value, 'list' will display a list of choices, and of
         * course, both does both (do you have a soft 'L' in there when you say
         * "both" out loud?)
        */
        autocomplete: React.PropTypes.oneOf(['both', 'inline', 'list']),

        /**
         * Called when the combobox receives user input, this is your chance to
         * filter the data and rerender the options.
         *
         * Signature:
         *
         * ```js
         * function(userInput){}
         * ```
        */
        onInput: React.PropTypes.func,

        /**
         * Called when the combobox receives a keyUp of user input, as opposed to
         * onInput which goes off on change events only. This callback gets passed
         * the raw event.
         *
         * Signature:
         *
         * ```js
         * function(event){}
         * ```
        */
        onInputKeyUp: React.PropTypes.func,


        /**
         * Called when the combobox receives a selection. You probably want to reset
         * the options to the full list at this point.
         *
         * Signature:
         *
         * ```js
         * function(selectedValue){}
         * ```
        */
        onFocusOption: React.PropTypes.func,

        /**
         * Called when the combobox is blurred.
         *
         * Signature:
         *
         * ```js
         * function(){}
         * ```
        */
        onBlur: React.PropTypes.func,

        /**
         * Called when the combobox is *closed* via making a selection (with
         * the enter key or a click).
         *
         * Signature:
         *
         * ```js
         * function(selectedValue){}
         * ```
        */
        onSelect: React.PropTypes.func,

        /**
         * Function used to compare Option values instead of the default `===`.
         *
         * Signature:
         *
         * ```js
         * function(value1, value2){} => bool
         * ```
        */
        valueComparator: React.PropTypes.func,

        /**
         * The initial value of the component.
        */
        value: React.PropTypes.any,

        /**
         * The tabIndex of the autocomplete input.
        */
        tabIndex: React.PropTypes.string,

        /**
         * The max-height to apply to the menu of autocomplete options
        */
        maxMenuHeight: React.PropTypes.number
    },

    getDefaultProps: function() {
        return {
            autocomplete: 'both',
            onInput: k,
            onFocusOption: k,
            onBlur: k,
            onSelect: k,
            valueComparator: eq,
            value: null,
            maxMenuHeight: Infinity
        };
    },

    getInitialState: function() {
        return {
            value: this.props.value,
            // the value displayed in the input
            inputValue: this.findInputValue(),
            isOpen: false,
            focusedIndex: null,
            matchedAutocompleteOption: null,
            // this prevents crazy jumpiness since we focus options on mouseenter
            usingKeyboard: false,
            activedescendant: null,
            menu: {
                children: [],
                activedescendant: null,
                isEmpty: true
            }
        };
    },

    componentWillMount: function() {
        this.setState({menu: this.makeMenu()});
    },

    componentWillReceiveProps: function(newProps) {
        var newState = {
            menu: this.makeMenu(newProps.children)
        };
        if (newProps.value && newProps.value !== this.props.value) {
            newState.inputValue = this.findInputValue(newProps.value);
        }
        this.setState(newState);
    },

    // ***** PART THE FIRST: turn browser events into 2nd-order events ********

    handleButtonClick: function() {
        this.state.isOpen ? this.hideList() : this.showList();
        this.focusInput();
    },

    handleKeydown: function(event) {
        var handlerName = this.inputKeydownMap[event.keyCode];
        if (!handlerName) {
            return;
        }
        if (this.state.isOpen) {
            event.preventDefault();
        } else if (event.keyCode === 9) {
            return;
        }
        this.setState({usingKeyboard: true});
        this[handlerName].call(this);
    },

    handleOptionKeyDown: function(child, event) {
        var handlerName = this.optionKeydownMap[event.keyCode];
        if (!handlerName) {
            // if the user starts typing again while focused on an option, move focus
            // to the input, select so it wipes out any existing value
            this.selectInput();
            return;
        }
        event.preventDefault();
        this.setState({usingKeyboard: true});
        this[handlerName].call(this, child);
    },

    handleOptionMouseEnter: function(index) {
        if (this.state.usingKeyboard) {
            this.setState({usingKeyboard: false});
        } else {
            this.focusOptionAtIndex(index);
        }
    },

    handleInputKeyUp: function(event) {
        if (this.props.onInputKeyUp && this.props.onInputKeyUp(event)===false) {
            return;
        }
        if (
            this.state.menu.isEmpty ||
            // autocompleting while backspacing feels super weird, so let's not
            event.keyCode === 8 /*backspace*/ ||
            !this.props.autocomplete.match(/both|inline/)
        ) {
            return;
        }
        this.autocompleteInputValue();
    },

    handleInputChange: function(event) {
        var value = React.findDOMNode(this._input).value;
        this.clearSelectedState(function() {
            this.props.onInput(value);
            if (!this.state.isOpen) {
                this.showList();
            }
        }.bind(this), {inputValue: value});
    },

    handleInputBlur: function(event) {
        var focusedAnOption = this.state.focusedIndex != null;
        if (focusedAnOption) {
            return;
        }
        this.maybeSelectAutocompletedOption();
        this.hideList();
    },

    inputKeydownMap: {
        9: 'focusNext',
        38: 'focusPrevious',
        40: 'focusNext',
        27: 'hideOnEscape',
        13: 'selectOnEnter'
    },

    optionKeydownMap: {
        9: 'focusNext',
        38: 'focusPrevious',
        40: 'focusNext',
        13: 'selectOption',
        27: 'hideOnEscape'
    },

    // **** PART THE SECOND: dispatch on second-order events *********

    handleOptionBlur: function() {
        // don't want to hide the list if we focused another option
        this.blurTimer = setTimeout(this.hideList, 0);
    },

    handleOptionFocus: function() {
        // see `handleOptionBlur`
        clearTimeout(this.blurTimer);
    },

    showList: function() {
        if (this.props.autocomplete.match(/both|list/)) {
            this.setState({isOpen: true});
        }
    },

    hideList: function() {
        if (this.isMounted()) {
            this.setState({isOpen: false});
        }
        this.props.onBlur();
    },

    hideOnEscape: function() {
        this.hideList();
        this.focusInput();
    },

    focusInput: function() {
        React.findDOMNode(this._input).focus();
    },

    selectInput: function() {
        React.findDOMNode(this._input).select();
    },

    selectOnEnter: function() {
        this.maybeSelectAutocompletedOption();
        this.selectInput();
    },

    maybeSelectAutocompletedOption: function() {
        if (!this.state.matchedAutocompleteOption) {
            return;
        }
        this.selectOption(this.state.matchedAutocompleteOption, {focus: false});
    },

    /**
    * We don't create the <ComboboxOption> components, the user supplies them,
    * so before rendering we attach handlers to facilitate communication from
    * the ComboboxOption to the Combobox.
    */
    makeMenu: function(children) {
        var activedescendant;
        var isEmpty = true;
        children = children || this.props.children;
        var newChildren = React.Children.map(children, function(child, index) {
            if (child === null || child.type !== ComboboxOption) {
                // allow random elements to live in this list
                return child;
            }
            isEmpty = false;

            var valueMatch = this.props.valueComparator(
                this.state.value, child.props.value
            );
            // need an ID for WAI-ARIA
            var newId = valueMatch ?
                (child.props.id || 'rf-combobox-selected-'+(++guid))
                :
                child.props.id;
            if (valueMatch) {
                activedescendant = newId;
            }
            return React.cloneElement(child, {
                id: newId,
                isSelected: valueMatch,
                onBlur: this.handleOptionBlur,
                onClick: this.selectOption.bind(this, child),
                onTouchEnd: function() {
                    if (!this.cancelSelect) { this.selectOption(child); }
                }.bind(this),
                onFocus: this.handleOptionFocus,
                onKeyDown: this.handleOptionKeyDown.bind(this, child),
                onMouseEnter: this.handleOptionMouseEnter.bind(this, index)
            }, child.props.children);
        }.bind(this));
        return {
            children: newChildren,
            activedescendant: activedescendant,
            isEmpty: isEmpty
        };
    },

    getClassName: function() {
        var className = addClass(this.props.className, 'rf-combobox');
        if (this.state.isOpen) {
            className = addClass(className, 'rf-combobox-is-open');
        }
        return className;
    },

    /**
    * When the user begins typing again we need to clear out any state that has
    * to do with an existing or potential selection.
    */
    clearSelectedState: function(cb, overrides) {
        var newState = Object.assign({}, {
            focusedIndex: null,
            inputValue: null,
            value: null,
            matchedAutocompleteOption: null,
            activedescendant: null
        }, overrides);
        this.setState(newState, cb);
    },

    /**
    * Autocompletes the input value with a matching label of the first
    * ComboboxOption in the list and selects only the fragment that has
    * been added, allowing the user to keep typing naturally.
    */
    autocompleteInputValue: function() {
        if (
            this.props.autocomplete == false ||
            this.props.children.length === 0
        ) {
            return;
        }
        var input = React.findDOMNode(this._input);
        var inputValue = input.value;
        var firstChild = this.props.children.length ?
            this.props.children[0] :
            this.props.children;
        var label = getLabel(firstChild);
        var fragment = matchFragment(inputValue, label);
        if (!fragment) {
            return;
        }
        input.value = label;
        input.setSelectionRange(inputValue.length, label.length);
        this.setState({matchedAutocompleteOption: firstChild});
    },

    selectOption: function(child, options) {
        options = options || {};
        this.setState({
            value: child.props.value,
            inputValue: getLabel(child),
            matchedAutocompleteOption: null
        }, function() {
            this.props.onFocusOption(child.props.value, child);
            if (options.hide !== false) {
                this.props.onSelect(child.props.value, child);
                this.hideList();
            }
            if (options.focus !== false) {
                this.selectInput();
            }
        }.bind(this));
    },

    focusNext: function() {
        if (this.state.menu.isEmpty) {
            return;
        }
        var index = this.state.focusedIndex == null ?
            0
            :
            this.state.focusedIndex + 1;
        this.focusOptionAtIndex(index);
    },

    focusPrevious: function() {
        if (this.state.menu.isEmpty) {
            return;
        }
        var last = this.props.children.length - 1;
        var index = this.state.focusedIndex == null ?
            last
            :
            this.state.focusedIndex - 1;
        this.focusOptionAtIndex(index);
    },

    focusSelectedOption: function() {
        var selectedIndex;
        React.Children.forEach(this.props.children, function(child, index) {
            if (this.props.valueComparator(child.props.value, this.state.value)) {
                selectedIndex = index;
            }
        }.bind(this));
        this.showList();
        this.setState({
            focusedIndex: selectedIndex
        }, this.focusOption);
    },

    findInputValue: function(value) {
        value = value || this.props.value;
        // TODO: might not need this, we should know this in `makeMenu`
        var inputValue;
        React.Children.forEach(this.props.children, function(child) {
            if (this.props.valueComparator(child.props.value, value)) {
                inputValue = getLabel(child);
            }
        }.bind(this));
        return inputValue || value;
    },

    focusOptionAtIndex: function(index) {
        if (!this.state.isOpen && this.state.value) {
            return this.focusSelectedOption();
        }
        this.showList();
        var length = this.props.children.length;
        if (index === -1) {
            index = length - 1;
        } else if (index === length) {
            index = 0;
        }
        this.setState({
            focusedIndex: index
        }, this.focusOption);

        // Select the focused option:
        var focusedChild;
        React.Children.forEach(this.props.children, function(child, childIndex) {
            if (childIndex === index) {
                focusedChild = child;
            }
        });
        this.selectOption(focusedChild, {focus: false, hide: false});
    },

    focusOption: function() {
        var index = this.state.focusedIndex || 0;
        React.findDOMNode(this.refs.list).childNodes[index].focus();
    },

    recordBoundingBox: function() {
        var node = React.findDOMNode(this._input);
        this._rect = node.getBoundingClientRect();
    },

    componentDidMount: function() {
        this.recordBoundingBox();
    },
    componentDidUpdate: function() {
        this.recordBoundingBox();
    },

    portalStyles: function() {
        var input = this._input;
        if (!input) {
            return {};
        } else {
            var windowHeight;
            if (window.innerHeight) {
                windowHeight = window.innerHeight;
            } else {
                windowHeight = document.documentElement.clientHeight;
            }
            return {
                position: 'absolute',
                display: this.state.isOpen ? 'block' : 'none',
                overflow: 'scroll',
                maxHeight: this._rect
                    ? Math.min(this.props.maxMenuHeight, windowHeight - this._rect.bottom)
                    : 0
            };
        }
    },

    render: function() {
        return (
            <div className={this.getClassName()}>
                <input
                    type="text"
                    ref={(elm) => this._input = elm}
                    placeholder={this.props.placeholder}
                    disabled={this.props.disabled}
                    className="rf-combobox-input"
                    tabIndex={this.props.tabIndex}
                    defaultValue={this.props.value}
                    value={this.state.inputValue}
                    onChange={this.handleInputChange}
                    onBlur={this.handleInputBlur}
                    onKeyDown={this.handleKeydown}
                    onKeyUp={this.handleInputKeyUp}
                    role="combobox"
                    aria-activedescendant={this.state.menu.activedescendant}
                    aria-autocomplete={this.props.autocomplete}
                    aria-owns="react-autocomplete-results"
                />
                <span
                    aria-hidden="true"
                    className="rf-combobox-button"
                    onClick={this.handleButtonClick}
                >▾</span>
                <div style={{position: 'relative'}}>
                    {React.Children.count(this.props.children) > 0 && <div
                        style={this.portalStyles()}
                        id="react-autocomplete-results"
                        ref="list"
                        className="rf-combobox-list"
                        aria-expanded={this.state.isOpen+''}
                        onTouchStart={(evt) => { this.cancelSelect = false; }}
                        onTouchMove={(evt) => { this.cancelSelect = true; }}
                        role="listbox"
                        >{this.state.menu.children}
                    </div>}
                </div>
            </div>
        );
    }
});
