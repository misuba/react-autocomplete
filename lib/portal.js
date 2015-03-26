var React = require('react');


module.exports = React.createClass({
  displayName: 'Portal',

  componentDidMount() {
    this.node = document.createElement('div');
    this.node.style.display = 'inline';
    document.body.appendChild(this.node);
    this.renderPortal(this.props);
  },

  componentWillReceiveProps(nextProps) {
    this.renderPortal(nextProps);
  },

  componentWillUnmount() {
    document.body.removeChild(this.node);
  },

  renderPortal(props) {
    var container = React.createElement('div', {style: {display: 'inline'}, props.children);
    React.render(container, this.node);
  },

  render() {
    return null;
  }
});


